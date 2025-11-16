import { createRouter } from '@/lib/create-app'
import { adminCheckoutHandler } from '@/handlers/admin/checkout.handler'

const adminCheckoutRoute = createRouter()
	.basePath('/checkout')
	.post('/', ...adminCheckoutHandler)

export default adminCheckoutRoute


