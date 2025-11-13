import { StatusCode } from 'hono/utils/http-status'
import status from 'http-status'

type ResponseSuccess = {
  success: true
  msg: string
  code: StatusCode
  data?: any
}

type ResponseError = {
  success: false
  msg: string
  code: StatusCode
  errors?: unknown
}

export function ok(data: any, msg = 'Success', code: StatusCode = status.OK): ResponseSuccess {
  let res: ResponseSuccess = {
    success: true,
    msg,
    code,
  }

  if (data) {
    res = { ...res, data }
  }

  return res
}

export function err(
  msg: string,
  code: StatusCode = status.INTERNAL_SERVER_ERROR,
  errors?: unknown,
): ResponseError {
  return {
    success: false,
    code,
    msg,
    ...(errors !== undefined && { errors }),
  }
}
