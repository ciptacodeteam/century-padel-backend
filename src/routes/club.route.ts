import { createRouter } from '@/lib/create-app'
import { requireAuth } from '@/middlewares/auth'
import {
  approveJoinRequestHandler,
  createMyClubHandler,
  deleteMyClubHandler,
  getAllPublicClubsHandler,
  getClubJoinRequestsHandler,
  getMyClubHandler,
  getMyClubsHandler,
  getMyMembershipHandler,
  getPublicClubHandler,
  joinClubHandler,
  leaveClubHandler,
  rejectJoinRequestHandler,
  removeMemberHandler,
  updateMyClubHandler,
} from '@/handlers/club.handler'

const clubRoute = createRouter()
  .basePath('/clubs')
  // Protected routes - require authentication (must come before /:id)
  .get('/my', requireAuth, ...getMyClubsHandler)
  .get('/my/:id', requireAuth, ...getMyClubHandler)
  .get('/membership', requireAuth, ...getMyMembershipHandler)
  .post('/', requireAuth, ...createMyClubHandler)
  .post('/:id/request-join', requireAuth, ...joinClubHandler)
  .get('/:id/requests', requireAuth, ...getClubJoinRequestsHandler)
  .post('/:id/requests/:userId/approve', requireAuth, ...approveJoinRequestHandler)
  .delete('/:id/requests/:userId/reject', requireAuth, ...rejectJoinRequestHandler)
  .delete('/:id/leave', requireAuth, ...leaveClubHandler)
  .delete('/:id/members/:userId', requireAuth, ...removeMemberHandler)
  .put('/:id', requireAuth, ...updateMyClubHandler)
  .delete('/:id', requireAuth, ...deleteMyClubHandler)
  // Public routes - anyone can view public clubs
  .get('/', ...getAllPublicClubsHandler)
  .get('/:id', ...getPublicClubHandler)

export default clubRoute
