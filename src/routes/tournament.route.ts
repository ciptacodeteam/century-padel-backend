import { createRouter } from '@/lib/create-app'
import {
  getActiveTournamentsHandler,
  getAllTournamentsHandler,
  getTournamentHandler,
} from '@/handlers/tournament.handler'

const tournamentRoute = createRouter()
  .basePath('/tournaments')
  .get('/active', ...getActiveTournamentsHandler)
  .get('/', ...getAllTournamentsHandler)
  .get('/:id', ...getTournamentHandler)

export default tournamentRoute

