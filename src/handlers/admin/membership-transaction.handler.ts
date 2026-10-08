import { BadRequestException, NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import {
  IdSchema,
  idSchema,
  SearchQuerySchema,
  searchQuerySchema,
} from '@/lib/validation'
import { zValidator } from '@hono/zod-validator'
import {
  MembershipAcquisitionType,
  NotificationAudience,
  NotificationType,
  PaymentStatus,
  Prisma,
} from '@prisma/client'
import status from 'http-status'
import * as XLSX from 'xlsx'
import dayjs from 'dayjs'
import { z } from 'zod'
import {
  canTerminatePaidMembership,
  ensureCashierPaidPayment,
  getCompletedRefund,
  mergeRefundIntoPaymentMeta,
} from '@/services/refund.service'
import { transferMembershipBalance } from '@/services/membership-transfer.service'

const suspendMembershipSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  endDate: z.string().datetime().optional(),
})

const terminateMembershipRefundSchema = z
  .object({
    reason: z.string().trim().min(3).max(500),
    refundType: z.enum(['FULL', 'PARTIAL']),
    refundAmount: z.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.refundType === 'PARTIAL' && !value.refundAmount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['refundAmount'],
        message: 'Nominal refund sebagian wajib diisi',
      })
    }
  })

const transferMembershipBalanceSchema = z.object({
  toUserId: z.string().min(1),
  hours: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
})

// GET /admin/membership-transactions
// Get all membership transactions
const membershipTransactionsQuerySchema = searchQuerySchema.extend({
  source: z
    .enum(['cashier', 'online'])
    .optional()
    .describe('Filter by transaction source: cashier or online'),
})

export const getAllMembershipTransactionsHandler = factory.createHandlers(
  zValidator('query', membershipTransactionsQuerySchema, validateHook),
  async (c) => {
    try {
      const query = c.req.valid('query') as any
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { createdAt: 'desc' },
        searchableFields: [],
      })

      // Add source filter if provided
      let where = queryOptions.where || {}
      if (query.source) {
        if (query.source === 'cashier') {
          where = {
            ...where,
            invoice: { booking: { cashierId: { not: null } } },
          }
        } else if (query.source === 'online') {
          where = { ...where, invoice: { booking: { cashierId: null } } }
        }
      }

      const membershipTransactions = await db.membershipUser.findMany({
        ...queryOptions,
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
          membership: {
            select: {
              id: true,
              name: true,
              description: true,
              price: true,
              sessions: true,
              duration: true,
              benefits: {
                select: {
                  id: true,
                  benefit: true,
                },
              },
            },
          },
          invoice: {
            include: {
              payment: {
                include: {
                  method: {
                    select: {
                      id: true,
                      name: true,
                      logo: true,
                    },
                  },
                },
              },
            },
          },
          incomingTransfer: {
            include: {
              fromUser: { select: { id: true, name: true, phone: true } },
              transferredByAdmin: { select: { id: true, name: true } },
            },
          },
          outgoingTransfers: {
            include: {
              toUser: { select: { id: true, name: true, phone: true } },
              transferredByAdmin: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      })

      return c.json(ok(membershipTransactions), status.OK)
    } catch (error) {
      c.var.logger.fatal(
        `Error in getAllMembershipTransactionsHandler: ${error}`,
      )
      throw error
    }
  },
)

// GET /admin/membership-transactions/:id
// Get membership transaction detail
export const getMembershipTransactionDetailHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const membershipTransaction = await db.membershipUser.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              image: true,
            },
          },
          membership: {
            select: {
              id: true,
              name: true,
              description: true,
              content: true,
              price: true,
              sessions: true,
              duration: true,
              benefits: {
                select: {
                  id: true,
                  benefit: true,
                },
              },
            },
          },
          invoice: {
            include: {
              payment: {
                include: {
                  method: {
                    select: {
                      id: true,
                      name: true,
                      logo: true,
                      fees: true,
                      percentage: true,
                    },
                  },
                },
              },
            },
          },
          incomingTransfer: {
            include: {
              fromUser: { select: { id: true, name: true, phone: true } },
              transferredByAdmin: { select: { id: true, name: true } },
            },
          },
          outgoingTransfers: {
            include: {
              toUser: { select: { id: true, name: true, phone: true } },
              transferredByAdmin: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      })

      if (!membershipTransaction) {
        throw new NotFoundException('Membership transaction not found')
      }

      return c.json(ok(membershipTransaction), status.OK)
    } catch (error) {
      c.var.logger.fatal(
        `Error in getMembershipTransactionDetailHandler: ${error}`,
      )
      throw error
    }
  },
)

// POST /admin/membership-transactions/:id/transfer
// Transfer purchased balance into a separate, audited entitlement.
export const transferMembershipBalanceHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', transferMembershipBalanceSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const { toUserId, hours, reason } = c.req.valid('json')
      const adminId = c.var.admin?.id
      if (!adminId) {
        throw new BadRequestException('Super Admin tidak teridentifikasi')
      }

      const result = await db.$transaction((tx) =>
        transferMembershipBalance(tx, {
          sourceMembershipUserId: id,
          toUserId,
          hours,
          reason,
          adminId,
        }),
      )

      return c.json(
        ok(result, 'Saldo membership berhasil ditransfer'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in transferMembershipBalanceHandler: ${error}`)
      throw error
    }
  },
)

// PUT /admin/membership-transactions/:id/approve
// Approve membership transaction (update invoice/payment status)
export const approveMembershipTransactionHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const result = await db.$transaction(async (tx) => {
        const membershipTransaction = await tx.membershipUser.findUnique({
          where: { id },
          include: {
            invoice: {
              include: {
                payment: true,
              },
            },
          },
        })

        if (!membershipTransaction) {
          throw new NotFoundException('Membership transaction not found')
        }

        if (
          membershipTransaction.acquisitionType !==
            MembershipAcquisitionType.PURCHASE ||
          !membershipTransaction.invoice
        ) {
          throw new BadRequestException(
            'Saldo transfer tidak memiliki transaksi pembelian untuk disetujui',
          )
        }

        // Check if already paid
        if (
          membershipTransaction.invoice &&
          membershipTransaction.invoice.status === PaymentStatus.PAID
        ) {
          throw new BadRequestException(
            'Membership transaction is already paid',
          )
        }

        // Update invoice status to PAID
        if (membershipTransaction.invoice) {
          await tx.invoice.update({
            where: { id: membershipTransaction.invoice.id },
            data: {
              status: PaymentStatus.PAID,
              paidAt: new Date(),
            },
          })

          // Update payment status to PAID
          if (membershipTransaction.invoice.payment) {
            await tx.payment.update({
              where: { id: membershipTransaction.invoice.payment.id },
              data: {
                status: PaymentStatus.PAID,
                paidAt: new Date(),
              },
            })
          } else {
            await ensureCashierPaidPayment(tx, {
              ...membershipTransaction.invoice,
              paidAt: new Date(),
            })
          }
        }

        return membershipTransaction
      })

      return c.json(
        ok(result, 'Membership transaction approved successfully'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(
        `Error in approveMembershipTransactionHandler: ${error}`,
      )
      throw error
    }
  },
)

// PUT /admin/membership-transactions/:id/reject
// Reject membership transaction (cancel invoice/payment)
export const rejectMembershipTransactionHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const result = await db.$transaction(async (tx) => {
        const membershipTransaction = await tx.membershipUser.findUnique({
          where: { id },
          include: {
            invoice: {
              include: {
                payment: true,
              },
            },
          },
        })

        if (!membershipTransaction) {
          throw new NotFoundException('Membership transaction not found')
        }

        if (
          membershipTransaction.acquisitionType !==
            MembershipAcquisitionType.PURCHASE ||
          !membershipTransaction.invoice
        ) {
          throw new BadRequestException(
            'Saldo transfer tidak memiliki transaksi pembelian untuk ditolak',
          )
        }

        // Check if already cancelled
        if (
          membershipTransaction.invoice &&
          membershipTransaction.invoice.status === PaymentStatus.CANCELLED
        ) {
          throw new BadRequestException(
            'Membership transaction is already cancelled',
          )
        }

        // Update invoice status to CANCELLED
        if (membershipTransaction.invoice) {
          await tx.invoice.update({
            where: { id: membershipTransaction.invoice.id },
            data: {
              status: PaymentStatus.CANCELLED,
              cancelledAt: new Date(),
            },
          })

          // Update payment status to CANCELLED
          if (membershipTransaction.invoice.payment) {
            await tx.payment.update({
              where: { id: membershipTransaction.invoice.payment.id },
              data: {
                status: PaymentStatus.CANCELLED,
                cancelledAt: new Date(),
              },
            })
          }
        }

        return membershipTransaction
      })

      return c.json(
        ok(result, 'Membership transaction rejected successfully'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(
        `Error in rejectMembershipTransactionHandler: ${error}`,
      )
      throw error
    }
  },
)

// PUT /admin/membership-transactions/:id/suspend
// Suspend membership transaction
export const suspendMembershipTransactionHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', suspendMembershipSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const { reason, endDate } = c.req.valid('json')

      const membershipTransaction = await db.membershipUser.findUnique({
        where: { id },
      })

      if (!membershipTransaction) {
        throw new NotFoundException('Membership transaction not found')
      }

      if (membershipTransaction.isSuspended) {
        throw new BadRequestException('Membership is already suspended')
      }

      if (membershipTransaction.isExpired) {
        throw new BadRequestException(
          'Membership yang sudah berakhir tidak dapat ditangguhkan',
        )
      }

      const updated = await db.membershipUser.update({
        where: { id },
        data: {
          isSuspended: true,
          suspensionReason: reason,
          suspensionEndDate: endDate ? new Date(endDate) : null,
        },
      })

      return c.json(
        ok(updated, 'Membership berhasil ditangguhkan sementara'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(
        `Error in suspendMembershipTransactionHandler: ${error}`,
      )
      throw error
    }
  },
)

// PUT /admin/membership-transactions/:id/unsuspend
// Unsuspend membership transaction
export const unsuspendMembershipTransactionHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema

      const membershipTransaction = await db.membershipUser.findUnique({
        where: { id },
      })

      if (!membershipTransaction) {
        throw new NotFoundException('Membership transaction not found')
      }

      if (!membershipTransaction.isSuspended) {
        throw new BadRequestException('Membership is not suspended')
      }

      if (membershipTransaction.isExpired) {
        throw new BadRequestException(
          'Membership yang telah dihentikan permanen tidak dapat diaktifkan kembali',
        )
      }

      const updated = await db.membershipUser.update({
        where: { id },
        data: {
          isSuspended: false,
          suspensionReason: null,
          suspensionEndDate: null,
        },
      })

      return c.json(
        ok(updated, 'Membership berhasil diaktifkan kembali'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(
        `Error in unsuspendMembershipTransactionHandler: ${error}`,
      )
      throw error
    }
  },
)

// PUT /admin/membership-transactions/:id/terminate-refund
// Permanently terminate a paid membership and record a completed refund.
export const terminateMembershipWithRefundHandler = factory.createHandlers(
  zValidator('param', idSchema, validateHook),
  zValidator('json', terminateMembershipRefundSchema, validateHook),
  async (c) => {
    try {
      const { id } = c.req.valid('param') as IdSchema
      const { reason, refundType, refundAmount } = c.req.valid('json')
      const adminId = c.var.admin?.id ?? null
      const now = new Date()

      const result = await db.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM membership_users WHERE id = ${id} FOR UPDATE`,
        )
        const membershipTransaction = await tx.membershipUser.findUnique({
          where: { id },
          include: {
            membership: { select: { name: true } },
            invoice: { include: { payment: true } },
            outgoingTransfers: { select: { id: true }, take: 1 },
          },
        })

        if (!membershipTransaction) {
          throw new NotFoundException('Membership transaction not found')
        }

        if (
          membershipTransaction.acquisitionType !==
          MembershipAcquisitionType.PURCHASE
        ) {
          throw new BadRequestException(
            'Saldo hasil transfer tidak dapat dihentikan dengan refund',
          )
        }
        if (membershipTransaction.outgoingTransfers.length > 0) {
          throw new BadRequestException(
            'Membership yang pernah mentransfer saldo tidak dapat di-refund',
          )
        }

        const invoice = membershipTransaction.invoice
        let payment = invoice?.payment ?? null
        if (!invoice || !canTerminatePaidMembership(invoice, payment)) {
          throw new BadRequestException(
            'Hanya membership yang sudah dibayar yang dapat dihentikan dan di-refund',
          )
        }

        if (!payment) {
          payment = await ensureCashierPaidPayment(tx, invoice)
        }

        if (getCompletedRefund(payment.meta)) {
          throw new BadRequestException(
            'Refund membership ini sudah pernah dicatat',
          )
        }

        const amount =
          refundType === 'FULL' ? invoice.total : (refundAmount ?? 0)
        if (amount > invoice.total) {
          throw new BadRequestException(
            'Nominal refund tidak boleh melebihi total pembayaran',
          )
        }

        const refund = {
          type: refundType,
          amount,
          reason,
          status: 'COMPLETED' as const,
          refundedAt: now.toISOString(),
          terminatedByAdminId: adminId,
        }

        const membership = await tx.membershipUser.update({
          where: { id },
          data: {
            isExpired: true,
            isSuspended: true,
            suspensionReason: `Dihentikan permanen: ${reason}`,
            suspensionEndDate: null,
            endDate: now,
            remainingSessions: 0,
            remainingDuration: 0,
          },
        })

        await tx.payment.update({
          where: { id: payment.id },
          data: {
            meta: mergeRefundIntoPaymentMeta(
              payment.meta,
              refund,
            ) as Prisma.InputJsonValue,
          },
        })

        await tx.notification.create({
          data: {
            userId: membershipTransaction.userId,
            audience: NotificationAudience.USER,
            type: NotificationType.ADMIN_PUSH,
            title: 'Membership Dihentikan',
            message: `${membershipTransaction.membership.name} telah dihentikan permanen. Refund ${refundType === 'FULL' ? 'penuh' : 'sebagian'} sebesar Rp ${amount.toLocaleString('id-ID')} telah dicatat.`,
            data: {
              event: 'MEMBERSHIP_TERMINATED_REFUND',
              membershipUserId: id,
              invoiceNumber: invoice.number,
              refund,
            },
          },
        })

        return { membership, refund }
      })

      return c.json(
        ok(result, 'Membership berhasil dihentikan dan refund telah dicatat'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(
        `Error in terminateMembershipWithRefundHandler: ${error}`,
      )
      throw error
    }
  },
)

// GET /admin/membership-transactions/export/excel
// Export membership transactions to Excel
export const exportMembershipTransactionsToExcelHandler =
  factory.createHandlers(
    zValidator('query', searchQuerySchema, validateHook),
    async (c) => {
      try {
        const query = c.req.valid('query') as SearchQuerySchema
        const queryOptions = buildFindManyOptions(query, {
          defaultOrderBy: { createdAt: 'desc' },
          searchableFields: [],
        })

        const membershipTransactions = await db.membershipUser.findMany({
          ...queryOptions,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
              },
            },
            membership: {
              select: {
                id: true,
                name: true,
                description: true,
                price: true,
                sessions: true,
                duration: true,
                benefits: {
                  select: {
                    id: true,
                    benefit: true,
                  },
                },
              },
            },
            incomingTransfer: {
              include: {
                fromUser: { select: { name: true } },
                transferredByAdmin: { select: { name: true } },
              },
            },
            invoice: {
              include: {
                payment: {
                  include: {
                    method: {
                      select: {
                        id: true,
                        name: true,
                      },
                    },
                  },
                },
              },
            },
          },
        })

        // Transform membership transactions data to Excel format
        const excelData = membershipTransactions.map((transaction) => {
          // Get benefits
          const benefits =
            transaction.membership.benefits?.map((b) => b.benefit).join(', ') ||
            'N/A'

          return {
            'Transaction ID': transaction.id,
            'Acquisition Type': transaction.acquisitionType,
            'Invoice Number': transaction.invoice?.number || 'N/A',
            'Customer Name': transaction.user.name,
            'Customer Email': transaction.user.email || 'N/A',
            'Customer Phone': transaction.user.phone,
            'Membership Name': transaction.membership.name,
            'Membership Description':
              transaction.membership.description || 'N/A',
            'Membership Price': transaction.membership.price,
            'Total Hours': transaction.membership.sessions,
            'Duration (Days)': transaction.membership.duration,
            Benefits: benefits,
            'Start Date': dayjs(transaction.startDate).format('YYYY-MM-DD'),
            'End Date': dayjs(transaction.endDate).format('YYYY-MM-DD'),
            'Remaining Hours': transaction.remainingSessions,
            'Remaining Duration': transaction.remainingDuration,
            'Is Expired': transaction.isExpired ? 'Yes' : 'No',
            'Is Suspended': transaction.isSuspended ? 'Yes' : 'No',
            'Suspension Reason': transaction.suspensionReason || 'N/A',
            'Suspension End Date': transaction.suspensionEndDate
              ? dayjs(transaction.suspensionEndDate).format('YYYY-MM-DD')
              : 'N/A',
            'Payment Status': transaction.invoice?.status || 'N/A',
            'Payment Method':
              transaction.invoice?.payment?.method.name || 'N/A',
            'Total Paid': transaction.invoice?.total || 0,
            'Transferred Hours':
              transaction.incomingTransfer?.transferredHours || 0,
            'Transferred From':
              transaction.incomingTransfer?.fromUser.name || 'N/A',
            'Transfer Reason': transaction.incomingTransfer?.reason || 'N/A',
            'Transferred By':
              transaction.incomingTransfer?.transferredByAdmin.name || 'N/A',
            'Created At': dayjs(transaction.createdAt).format(
              'YYYY-MM-DD HH:mm:ss',
            ),
          }
        })

        // Create workbook and worksheet
        const worksheet = XLSX.utils.json_to_sheet(excelData)
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(
          workbook,
          worksheet,
          'Membership Transactions',
        )

        // Set column widths for better readability
        const columnWidths = [
          { wch: 30 }, // Transaction ID
          { wch: 25 }, // Invoice Number
          { wch: 25 }, // Customer Name
          { wch: 30 }, // Customer Email
          { wch: 20 }, // Customer Phone
          { wch: 25 }, // Membership Name
          { wch: 40 }, // Membership Description
          { wch: 15 }, // Membership Price
          { wch: 15 }, // Total Hours
          { wch: 15 }, // Duration (Days)
          { wch: 40 }, // Benefits
          { wch: 15 }, // Start Date
          { wch: 15 }, // End Date
          { wch: 18 }, // Remaining Hours
          { wch: 18 }, // Remaining Duration
          { wch: 12 }, // Is Expired
          { wch: 15 }, // Is Suspended
          { wch: 30 }, // Suspension Reason
          { wch: 20 }, // Suspension End Date
          { wch: 15 }, // Payment Status
          { wch: 20 }, // Payment Method
          { wch: 15 }, // Total Paid
          { wch: 20 }, // Created At
        ]
        worksheet['!cols'] = columnWidths

        // Generate Excel buffer
        const excelBuffer = XLSX.write(workbook, {
          type: 'buffer',
          bookType: 'xlsx',
        })

        // Generate filename with timestamp
        const filename = `membership-transactions-${dayjs().format('YYYY-MM-DD-HHmmss')}.xlsx`

        // Set headers for file download
        c.header(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        c.header('Content-Disposition', `attachment; filename="${filename}"`)

        return c.body(excelBuffer)
      } catch (error) {
        c.var.logger.fatal(
          `Error in exportMembershipTransactionsToExcelHandler: ${error}`,
        )
        throw error
      }
    },
  )
