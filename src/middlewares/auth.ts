import { ForbiddenException, UnauthorizedException } from '@/exceptions'
import { validateToken } from '@/lib/token'
import { AdminTokenPayload, UserTokenPayload } from '@/types'
import { Role } from '@prisma/client'
import { MiddlewareHandler } from 'hono'

export const globalAuthMiddleware: MiddlewareHandler = async (c, next) => {
  const authorization = c.req.header('Authorization')
    ? c.req.header('Authorization')
    : null

  if (!authorization || !authorization.startsWith('Bearer ')) {
    c.set('user', null)
    c.set('admin', null)
    return next()
  }

  const token = authorization.replace('Bearer ', '')

  c.var.logger.debug(`Global auth middleware - token: ${token}`)

  if (c.req.url.includes('/auth/refresh-token')) {
    console.log('🚀 ~ Skipping token validation for refresh-token endpoint')
    return next()
  }

  const session = await validateToken(token)
  const payload = session?.data as UserTokenPayload | AdminTokenPayload | null

  // clear both contexts initially
  c.set('admin', null)
  c.set('user', null)

  // type guard to discriminate admin payloads
  const isAdminPayload = (
    p: UserTokenPayload | AdminTokenPayload | null,
  ): p is AdminTokenPayload => {
    return !!p && (p as AdminTokenPayload).role !== undefined
  }

  if (payload) {
    if (isAdminPayload(payload)) {
      c.set('admin', payload)
    } else {
      c.set('user', payload as UserTokenPayload)
    }
  }

  return next()
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const user = c.get('user')

  if (!user) {
    throw new UnauthorizedException()
  }

  return next()
}

export const requireAdminAuth: MiddlewareHandler = async (c, next) => {
  const admin = c.get('admin')

  if (!admin || !admin.role) {
    throw new UnauthorizedException()
  }

  return next()
}

export const requireAdmin: MiddlewareHandler = async (c, next) => {
  return requireRole('ADMIN')(c, next)
}

export const requireCoach: MiddlewareHandler = async (c, next) => {
  return requireRole('COACH')(c, next)
}

export const requireBallboy: MiddlewareHandler = async (c, next) => {
  return requireRole('BALLBOY')(c, next)
}

export const requireCashier: MiddlewareHandler = async (c, next) => {
  return requireRole('CASHIER')(c, next)
}

export const requireAdminViewer: MiddlewareHandler = async (c, next) => {
  return requireRole('ADMIN_VIEWER')(c, next)
}

// Allow both ADMIN and the legacy ADMIN_VIEWER value (displayed as Manager).
export const requireAdminOrViewer: MiddlewareHandler = async (c, next) => {
  const admin = c.get('admin')

  if (!admin) {
    throw new UnauthorizedException()
  }

  if (admin.role !== 'ADMIN' && admin.role !== 'ADMIN_VIEWER') {
    throw new ForbiddenException()
  }

  return next()
}

// Only allow ADMIN for operations reserved for the owner-level admin.
export const requireAdminWriteAccess: MiddlewareHandler = async (c, next) => {
  const admin = c.get('admin')

  if (!admin) {
    throw new UnauthorizedException()
  }

  if (admin.role !== 'ADMIN') {
    throw new ForbiddenException('Admin write access required')
  }

  return next()
}

const managerRestrictedAnalyticsPaths = [
  '/admin/analytics/income-by-source',
  '/admin/analytics/payment-methods',
]

export function isManagerRestrictedAnalyticsPath(path: string): boolean {
  return managerRestrictedAnalyticsPaths.some(
    (restrictedPath) =>
      path === restrictedPath || path.startsWith(`${restrictedPath}/`),
  )
}

// ADMIN_VIEWER is retained as the persisted enum value for backwards
// compatibility, but represents the Manager role in the application.
export const enforceManagerRestrictions: MiddlewareHandler = async (
  c,
  next,
) => {
  const admin = c.get('admin')
  const path = c.req.path

  if (
    admin &&
    admin.role === 'ADMIN_VIEWER' &&
    isManagerRestrictedAnalyticsPath(path)
  ) {
    throw new ForbiddenException(
      'Manager cannot access restricted financial analytics.',
    )
  }

  return next()
}

// You can add more role-based middlewares as needed
export const requireRole = (role: Role) => {
  const middleware: MiddlewareHandler = async (c, next) => {
    const admin = c.get('admin')

    if (!admin) {
      throw new UnauthorizedException()
    }

    if (admin.role !== role) {
      throw new ForbiddenException()
    }

    return next()
  }
  return middleware
}
