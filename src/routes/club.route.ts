import { createRouter } from '@/lib/create-app'
import { requireAuth } from '@/middlewares/auth'
import {
  createMyClubHandler,
  deleteMyClubHandler,
  getAllPublicClubsHandler,
  getMyClubHandler,
  getMyClubsHandler,
  getPublicClubHandler,
  joinClubHandler,
  leaveClubHandler,
  updateMyClubHandler,
} from '@/handlers/club.handler'

const clubRoute = createRouter()
  .basePath('/clubs')
  // Protected routes - require authentication (must come before /:id)
  .get('/my', requireAuth, ...getMyClubsHandler)
  .get('/my/:id', requireAuth, ...getMyClubHandler)
  .post('/', requireAuth, ...createMyClubHandler)
  .post('/:id/join', requireAuth, ...joinClubHandler)
  .delete('/:id/leave', requireAuth, ...leaveClubHandler)
  .put('/:id', requireAuth, ...updateMyClubHandler)
  .delete('/:id', requireAuth, ...deleteMyClubHandler)
  // Public routes - anyone can view public clubs
  .get('/', ...getAllPublicClubsHandler)
  .get('/:id', ...getPublicClubHandler)

export default clubRoute
