import { createRouter } from '@/lib/create-app'
import {
  rescheduleMembershipStartHandler,
  approveMembershipTransactionHandler,
  grantMembershipComplimentaryHandler,
  cancelMembershipTransferHandler,
  exportMembershipTransactionsToExcelHandler,
  getAllMembershipTransactionsHandler,
  getMembershipTransactionDetailHandler,
  rejectMembershipTransactionHandler,
  suspendMembershipTransactionHandler,
  terminateMembershipWithRefundHandler,
  transferMembershipBalanceHandler,
  unsuspendMembershipTransactionHandler,
} from '@/handlers/admin/membership-transaction.handler'
import { requireAdminWriteAccess } from '@/middlewares/auth'

const adminMembershipTransactionRoute = createRouter()
  .basePath('/membership-transactions')
  .get('/', ...getAllMembershipTransactionsHandler)
  .get('/export/excel', ...exportMembershipTransactionsToExcelHandler)
  .get('/:id', ...getMembershipTransactionDetailHandler)
  .post(
    '/:id/complimentary',
    requireAdminWriteAccess,
    ...grantMembershipComplimentaryHandler,
  )
  .post(
    '/:id/transfer',
    requireAdminWriteAccess,
    ...transferMembershipBalanceHandler,
  )
  .post(
    '/:id/transfers/:transferId/cancel',
    requireAdminWriteAccess,
    ...cancelMembershipTransferHandler,
  )
  .put(
    '/:id/start-date',
    requireAdminWriteAccess,
    ...rescheduleMembershipStartHandler,
  )
  .put('/:id/approve', ...approveMembershipTransactionHandler)
  .put('/:id/reject', ...rejectMembershipTransactionHandler)
  .put('/:id/suspend', ...suspendMembershipTransactionHandler)
  .put('/:id/terminate-refund', ...terminateMembershipWithRefundHandler)
  .put('/:id/unsuspend', ...unsuspendMembershipTransactionHandler)

export default adminMembershipTransactionRoute
