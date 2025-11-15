import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import buildFindManyOptions from '@/lib/query'
import { ok } from '@/lib/response'
import { SearchQuerySchema, searchQuerySchema } from '@/lib/validation'
import { requireAuth } from '@/middlewares/auth'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'
import { z } from 'zod'
import { PaymentStatus } from '@prisma/client'
import xenditService from '@/services/xendit.service'

// GET /invoices
export const getUserInvoicesHandler = factory.createHandlers(
  requireAuth,
  zValidator('query', searchQuerySchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      if (!user || !user.id) {
        throw new Error('Unauthorized')
      }

      const query = c.req.valid('query') as SearchQuerySchema
      const queryOptions = buildFindManyOptions(query, {
        defaultOrderBy: { issuedAt: 'desc' },
        searchableFields: ['status', 'dueDate'],
      })

      const invoices = await db.invoice.findMany({
        ...queryOptions,
        where: {
          ...queryOptions.where,
          userId: user.id,
        },
        include: {
          booking: {
            select: {
              id: true,
              status: true,
              totalPrice: true,
              createdAt: true,
              details: {
                select: {
                  id: true,
                  court: { select: { id: true, name: true } },
                  price: true,
                  slot: true,
                  createdAt: true,
                },
              },
            },
          },
          classBooking: {
            select: {
              id: true,
              status: true,
              createdAt: true,
              class: { select: { id: true, name: true } },
            },
          },
          membershipUser: {
            select: {
              id: true,
              startDate: true,
              endDate: true,
              membership: { select: { id: true, name: true } },
            },
          },
        },
      })

      return c.json(ok(invoices), status.OK)
    } catch (error) {
      c.var.logger.fatal(`Error in getUserInvoicesHandler: ${error}`)
      throw error
    }
  },
)

// GET /invoices/:id (detail)
export const getInvoiceDetailHandler = factory.createHandlers(
  requireAuth,
  zValidator('param', z.object({ id: z.string().min(1) }), validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      if (!user || !user.id) {
        throw new Error('Unauthorized')
      }

      const { id } = c.req.valid('param') as { id: string }

      const invoice: any = await db.invoice.findFirst({
        where: { number: id, userId: user.id },
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          booking: {
            select: {
              id: true,
              status: true,
              totalPrice: true,
              processingFee: true,
              createdAt: true,
              details: {
                select: {
                  id: true,
                  price: true,
                  slot: true,
                  court: { select: { id: true, name: true } },
                },
              },
              inventories: {
                select: {
                  id: true,
                  quantity: true,
                  price: true,
                  inventory: { select: { id: true, name: true } },
                },
              },
              coaches: {
                select: {
                  id: true,
                  price: true,
                  bookingCoachType: { select: { id: true, name: true } },
                  slot: {
                    include: {
                      staff: { select: { id: true, name: true, role: true } },
                    },
                  },
                },
              },
              ballboys: {
                select: {
                  id: true,
                  price: true,
                  slot: {
                    include: {
                      staff: { select: { id: true, name: true, role: true } },
                    },
                  },
                },
              },
            },
          },
          classBooking: {
            select: {
              id: true,
              status: true,
              class: { select: { id: true, name: true } },
            },
          },
          membershipUser: {
            select: {
              id: true,
              startDate: true,
              endDate: true,
              membership: { select: { id: true, name: true } },
            },
          },
          payment: {
            select: {
              id: true,
              status: true,
              amount: true,
              fees: true,
              externalRef: true,
              dueDate: true,
              paidAt: true,
              meta: true,
              method: {
                select: {
                  id: true,
                  name: true,
                  logo: true,
                  channel: true,
                  fees: true,
                  percentage: true,
                },
              },
            },
          },
        },
      })

      if (!invoice) {
        return c.json(ok(null, 'Invoice not found'), status.NOT_FOUND)
      }

      // Parse stored meta JSON (if any)
      let storedMeta: any = null
      if (invoice.payment?.meta) {
        try {
          storedMeta = JSON.parse(invoice.payment.meta as any)
        } catch (e) {
          c.var.logger.error(`Failed parsing payment meta: ${e}`)
        }
      }

      // Build payment instructions if pending/awaiting
      let paymentInstructions: any = null
      if (
        invoice.payment &&
        [PaymentStatus.PENDING, PaymentStatus.AWAITING_CONFIRMATION].includes(
          invoice.payment.status,
        )
      ) {
        // Attempt to fetch live payment request details from Xendit v3
        let paymentRequest: any = null
        if (invoice.payment.externalRef) {
          paymentRequest = await xenditService.getPaymentRequestV3(
            invoice.payment.externalRef,
          )
        }

        const channelCode = paymentRequest?.channel_code
        const channelProps = paymentRequest?.channel_properties || {}
        const actions = paymentRequest?.actions || {}

        // Virtual Account detection (sample heuristic)
        if (channelCode && channelCode.toUpperCase().includes('VA')) {
          paymentInstructions = {
            type: 'VIRTUAL_ACCOUNT',
            bankCode: channelProps.bank_code || channelProps.bank || null,
            accountNumber: channelProps.account_number || null,
            accountName: channelProps.account_name || null,
            expiresAt: invoice.payment.dueDate || null,
          }
        } else if (channelCode && channelCode.toUpperCase().includes('QR')) {
          // QRIS style
          paymentInstructions = {
            type: 'QRIS',
            qrString: channelProps.qr_string || null,
            qrImage:
              actions?.desktop_web_checkout_url ||
              actions?.mobile_web_checkout_url ||
              null,
            expiresAt: invoice.payment.dueDate || null,
          }
        } else if (storedMeta?.invoiceUrl) {
          // Fallback to invoice URL if we only have legacy invoice meta
          paymentInstructions = {
            type: 'INVOICE_URL',
            url: storedMeta.invoiceUrl,
            expiresAt: invoice.payment.dueDate || null,
          }
        }
      }

      const responsePayload = {
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        subtotal: invoice.subtotal,
        processingFee: invoice.processingFee,
        total: invoice.total,
        issuedAt: invoice.issuedAt,
        dueDate: invoice.dueDate,
        paidAt: invoice.paidAt,
        user: invoice.user,
        booking: invoice.booking,
        classBooking: invoice.classBooking,
        membershipUser: invoice.membershipUser,
        payment: invoice.payment,
        paymentMeta: storedMeta,
        paymentInstructions,
      }

      return c.json(
        ok(responsePayload, 'Invoice detail fetched successfully'),
        status.OK,
      )
    } catch (error) {
      c.var.logger.fatal(`Error in getInvoiceDetailHandler: ${error}`)
      throw error
    }
  },
)
