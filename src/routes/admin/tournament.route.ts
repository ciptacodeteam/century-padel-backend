import { createRouter } from '@/lib/create-app'
import {
  createTournamentHandler,
  deleteTournamentHandler,
  getAllTournamentHandler,
  getTournamentHandler,
  updateTournamentHandler,
} from '@/handlers/admin/tournament.handler'

const adminTournamentRoute = createRouter()
  .basePath('/tournaments')
  .get('/', ...getAllTournamentHandler)
  .get('/:id', ...getTournamentHandler)
  .post('/', ...createTournamentHandler)
  .put('/:id', ...updateTournamentHandler)
  .delete('/:id', ...deleteTournamentHandler)

export default adminTournamentRoute

