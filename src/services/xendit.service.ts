import { env } from '@/env'
import { log } from '@/lib/logger'

interface CreateInvoiceRequest {
  externalId: string // Your invoice ID
  amount: number // Amount in rupiah
  payerEmail?: string
  description?: string
  invoiceDuration?: number // in seconds
  callbackVirtualAccountIds?: string[] // for VA payments
  successRedirectUrl?: string
  failureRedirectUrl?: string
  items?: Array<{
    name: string
    quantity: number
    price: number
  }>
  customer?: {
    givenNames: string
    surname?: string
    email?: string
    mobileNumber?: string
  }
}

interface XenditInvoiceResponse {
  id: string
  external_id: string
  user_id: string
  status: 'PENDING' | 'PAID' | 'EXPIRED'
  merchant_name: string
  amount: number
  payer_email?: string
  description?: string
  created: string
  updated: string
  expiry_date?: string
  invoice_url: string
}

interface CreateVirtualAccountRequest {
  externalId: string
  bankCode: string // BCA, BRI, MANDIRI, etc.
  name: string
  expectedAmount?: number
}

interface XenditVirtualAccountResponse {
  id: string
  external_id: string
  owner_id: string
  bank_code: string
  account_number: string
  name: string
  status: 'ACTIVE' | 'INACTIVE'
  expiration_date: string
  is_single_use: boolean
  is_closed: boolean
  currency: string
}

export interface CreatePaymentRequestV3 {
  referenceId: string
  requestAmount: number
  country?: string // e.g., "ID"
  currency?: string // e.g., "IDR"
  captureMethod?: string // e.g., "AUTOMATIC"
  channelCode: string
  channelProperties: Record<string, any>
  description?: string
  metadata?: Record<string, any>
}

export interface PaymentAction {
  type: 'REDIRECT_CUSTOMER' | 'PRESENT_TO_CUSTOMER'
  value: string
  descriptor?: 'WEB_URL' | 'MOBILE_URL' | 'QR_CODE' | 'ACCOUNT_NUMBER'
}

export interface XenditPaymentRequestV3Response {
  id: string
  business_id?: string
  reference_id: string
  payment_request_id?: string
  type: 'PAY'
  status: 'REQUIRES_ACTION' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'EXPIRED'
  country: string
  currency: string
  request_amount: number
  capture_method: string
  channel_code: string
  channel_properties: Record<string, any>
  actions?: PaymentAction[]
  description?: string
  metadata?: Record<string, any>
  payment_details?: Record<string, any>
  created?: string
  updated?: string
  failure_code?: string
}

// Credit Card Tokenization Interfaces
export interface TokenizeCreditCardRequest {
  cardNumber: string
  cardholderName: string
  expiryMonth: number
  expiryYear: number
  cvv: string
  currency?: string // e.g., "IDR"
}

export interface TokenizeCreditCardResponse {
  id: string // Token ID for use in payment requests
  status: string
  card_number_last_four: string
  card_brand: string
  card_fingerprint?: string
  created: string
  updated: string
  expiry_month: number
  expiry_year: number
  cardholder_name: string
}

// 3DS Challenge Interfaces
export interface Create3DSChallengeRequest {
  paymentRequestId: string
  threeDsActionToken?: string // From challenge action
}

export interface Authenticate3DSRequest {
  paymentRequestId: string
  authenticationToken: string // OTP or challenge response
}

export interface Authenticate3DSResponse {
  id: string
  status: 'SUCCEEDED' | 'FAILED' | 'REQUIRES_ACTION'
  payment_id?: string
  message?: string
}

// Webhook event types
export interface XenditPaymentWebhookData {
  payment_id: string
  business_id: string
  reference_id: string
  payment_request_id: string
  type: 'PAY'
  country: string
  currency: string
  request_amount: number
  capture_method: string
  channel_code: string
  channel_properties: Record<string, any>
  captures?: Array<{
    capture_id: string
    capture_amount: number
    capture_timestamp: string
  }>
  status: 'SUCCEEDED' | 'FAILED'
  payment_details?: Record<string, any>
  metadata?: Record<string, any>
  failure_code?: string
  created: string
  updated: string
}

export interface XenditPaymentWebhook {
  event: 'payment.capture' | 'payment.failure'
  business_id: string
  created: string
  data: XenditPaymentWebhookData
}

class XenditService {
  private apiKey: string
  private baseUrl = 'https://api.xendit.co'

  constructor() {
    this.apiKey = env.xendit.apiKey
    if (!this.apiKey) {
      log.warn('Xendit API key not configured')
    }
  }

  private getHeaders(apiVersion?: string) {
    const version = apiVersion ?? '2024-11-11'

    return {
      Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString('base64')}`,
      'Content-Type': 'application/json',
      'api-version': version,
    }
  }

  async createInvoice(
    data: CreateInvoiceRequest,
  ): Promise<XenditInvoiceResponse> {
    try {
      log.info(`Creating Xendit invoice for externalId: ${data.externalId}`)

      const response = await fetch(`${this.baseUrl}/v2/invoices`, {
        method: 'POST',
        headers: this.getHeaders('2022-07-31'),
        body: JSON.stringify({
          external_id: data.externalId,
          amount: data.amount,
          payer_email: data.payerEmail,
          description: data.description || 'Invoice payment',
          invoice_duration: data.invoiceDuration || 86400, // 24 hours
          success_redirect_url: data.successRedirectUrl,
          failure_redirect_url: data.failureRedirectUrl,
          items: data.items || [],
          customer: data.customer,
          // For VA payments
          ...(data.callbackVirtualAccountIds && {
            callback_virtual_account_ids: data.callbackVirtualAccountIds,
          }),
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        log.error(`Xendit API error: ${response.status} - ${errorText}`)
        throw new Error(`Xendit API error: ${response.status}`)
      }

      const result = (await response.json()) as any
      log.info(`Xendit invoice created: ${result.id}`)
      return result
    } catch (error) {
      log.fatal(`Error creating Xendit invoice: ${error}`)
      throw error
    }
  }

  async createVirtualAccount(
    data: CreateVirtualAccountRequest,
  ): Promise<XenditVirtualAccountResponse> {
    try {
      log.info(
        `Creating Xendit Virtual Account for externalId: ${data.externalId}`,
      )

      const response = await fetch(`${this.baseUrl}/virtual_accounts`, {
        method: 'POST',
        headers: this.getHeaders('2022-07-31'),
        body: JSON.stringify({
          external_id: data.externalId,
          bank_code: data.bankCode,
          name: data.name,
          expected_amount: data.expectedAmount,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        log.error(`Xendit VA API error: ${response.status} - ${errorText}`)
        throw new Error(`Xendit VA API error: ${response.status}`)
      }

      const result = (await response.json()) as any
      log.info(`Xendit VA created: ${result.id}`)
      return result
    } catch (error) {
      log.fatal(`Error creating Xendit Virtual Account: ${error}`)
      throw error
    }
  }

  async getInvoice(invoiceId: string): Promise<XenditInvoiceResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/v2/invoices/${invoiceId}`, {
        method: 'GET',
        headers: this.getHeaders(),
      })

      if (!response.ok) {
        const errorText = await response.text()
        log.error(`Xendit API error: ${response.status} - ${errorText}`)
        throw new Error(`Xendit API error: ${response.status}`)
      }

      return (await response.json()) as any
    } catch (error) {
      log.fatal(`Error getting Xendit invoice: ${error}`)
      throw error
    }
  }

  async getVirtualAccount(vaId: string): Promise<XenditVirtualAccountResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/virtual_accounts/${vaId}`, {
        method: 'GET',
        headers: this.getHeaders(),
      })

      if (!response.ok) {
        const errorText = await response.text()
        log.error(`Xendit VA API error: ${response.status} - ${errorText}`)
        throw new Error(`Xendit VA API error: ${response.status}`)
      }

      return (await response.json()) as any
    } catch (error) {
      log.fatal(`Error getting Xendit Virtual Account: ${error}`)
      throw error
    }
  }

  async createPaymentRequestV3(
    data: CreatePaymentRequestV3,
  ): Promise<XenditPaymentRequestV3Response> {
    try {
      log.info(
        `Creating Xendit v3 payment request for referenceId: ${data.referenceId}, channel: ${data.channelCode}`,
      )

      const requestBody = {
        reference_id: data.referenceId,
        type: 'PAY',
        country: data.country || 'ID',
        currency: data.currency || 'IDR',
        request_amount: data.requestAmount,
        capture_method: data.captureMethod || 'AUTOMATIC',
        channel_code: data.channelCode,
        channel_properties: data.channelProperties,
        description: data.description,
        metadata: data.metadata,
      }

      log.debug(`Xendit request body: ${JSON.stringify(requestBody, null, 2)}`)

      const response = await fetch(`${this.baseUrl}/v3/payment_requests`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(requestBody),
      })

      const rawResult = (await response.json()) as any

      if (!response.ok) {
        const errorMessage =
          rawResult?.message || rawResult?.error_code || 'Unknown error'
        log.error(
          `Xendit v3 API error: ${response.status} - ${JSON.stringify(rawResult)}`,
        )

        // Provide helpful error message for IP allowlist issue
        if (rawResult?.error_code === 'UNAUTHORIZED_SENDER_IP') {
          throw new Error(
            `Xendit IP not allowlisted. Add your server IP to: https://dashboard.xendit.co/settings/developers#ip-allowlist`,
          )
        }

        throw new Error(
          `Xendit v3 API error: ${response.status} - ${errorMessage}`,
        )
      }

      const result = (rawResult?.data ??
        rawResult) as XenditPaymentRequestV3Response

      if (!result?.id) {
        log.warn(
          {
            referenceId: data.referenceId,
            rawResult,
          },
          'Xendit v3 payment request response missing id field',
        )
      } else {
        log.info(
          `Xendit v3 payment request created: ${result.id}, status: ${result.status}, actions: ${result.actions?.length || 0}`,
        )
      }

      return result
    } catch (error) {
      log.fatal(`Error creating Xendit v3 payment request: ${error}`)
      throw error
    }
  }

  verifyCallbackToken(token: string): boolean {
    // Trim whitespace from both tokens to avoid issues with copy-paste
    const receivedToken = token?.trim() || ''
    const expectedToken = env.xendit.callbackToken?.trim() || ''

    if (!expectedToken) {
      log.warn('XENDIT_CALLBACK_TOKEN is not set in environment variables')
      return false
    }

    const isValid = receivedToken === expectedToken

    if (!isValid) {
      log.warn(
        `Token mismatch. Received (first 10): ${receivedToken.substring(0, 10)}..., ` +
          `Expected (first 10): ${expectedToken.substring(0, 10)}...`,
      )
    }

    return isValid
  }

  async getPaymentRequestV3(
    id: string,
  ): Promise<XenditPaymentRequestV3Response | null> {
    try {
      log.info(`Fetching Xendit v3 payment request: ${id}`)
      const response = await fetch(
        `${this.baseUrl}/v3/payment_requests/${id}`,
        {
          method: 'GET',
          headers: this.getHeaders(),
        },
      )

      const rawResult = (await response.json()) as any

      if (!response.ok) {
        log.error(
          `Xendit v3 get payment request error: ${response.status} - ${JSON.stringify(rawResult)}`,
        )
        return null
      }

      const result = (rawResult?.data ??
        rawResult) as XenditPaymentRequestV3Response

      log.info(`Payment request ${id} status: ${result.status}`)
      return result
    } catch (error) {
      log.error(`Error fetching Xendit payment request: ${error}`)
      return null
    }
  }

  /**
   * Cancel a payment request that is in REQUIRES_ACTION status
   */
  async cancelPaymentRequestV3(id: string): Promise<boolean> {
    try {
      log.info(`Canceling Xendit v3 payment request: ${id}`)
      const response = await fetch(
        `${this.baseUrl}/v3/payment_requests/${id}/cancel`,
        {
          method: 'POST',
          headers: this.getHeaders(),
        },
      )

      if (!response.ok) {
        const errorText = await response.text()
        log.error(
          `Xendit v3 cancel payment request error: ${response.status} - ${errorText}`,
        )
        return false
      }

      log.info(`Payment request ${id} canceled successfully`)
      return true
    } catch (error) {
      log.error(`Error canceling Xendit payment request: ${error}`)
      return false
    }
  }

  /**
   * Test mode: simulate payment completion for a given Payment Request ID.
   * Xendit will deliver the result via webhook (payment.capture/payment.failure).
   */
  async simulatePaymentRequestV3(
    paymentRequestId: string,
    amount?: number,
  ): Promise<{ status: string; message: string } | null> {
    try {
      log.info(`Simulating Xendit v3 payment request: ${paymentRequestId}`)
      const body = amount ? { amount } : undefined
      const response = await fetch(
        `${this.baseUrl}/v3/payment_requests/${paymentRequestId}/simulate`,
        {
          method: 'POST',
          headers: this.getHeaders(),
          body: body ? JSON.stringify(body) : undefined,
        },
      )

      const raw = (await response.json()) as any
      if (!response.ok) {
        log.error(
          `Xendit v3 simulate error: ${response.status} - ${JSON.stringify(
            raw,
          )}`,
        )
        return null
      }
      const result = raw?.data ?? raw
      log.info(`Simulation accepted: ${JSON.stringify(result)}`)
      return { status: result?.status || 'PENDING', message: result?.message }
    } catch (error) {
      log.error(`Error simulating Xendit payment request: ${error}`)
      return null
    }
  }

  /**
   * Tokenize a credit card for storage and reuse
   * Xendit's tokenization securely stores card data server-side
   */
  async tokenizeCreditCard(
    data: TokenizeCreditCardRequest,
  ): Promise<TokenizeCreditCardResponse | null> {
    try {
      log.info(
        `Tokenizing credit card for ${data.cardholderName || 'customer'}`,
      )

      const requestBody = {
        card_number: data.cardNumber,
        cardholder_name: data.cardholderName,
        expiry_month: data.expiryMonth,
        expiry_year: data.expiryYear,
        cvv: data.cvv,
        currency: data.currency || 'IDR',
      }

      const response = await fetch(`${this.baseUrl}/v2/card_tokens`, {
        method: 'POST',
        headers: this.getHeaders('2022-07-31'),
        body: JSON.stringify(requestBody),
      })

      const result = (await response.json()) as any

      if (!response.ok) {
        log.error(
          `Xendit tokenization error: ${response.status} - ${JSON.stringify(result)}`,
        )
        return null
      }

      log.info(`Credit card tokenized: ${result.id}`)
      return result
    } catch (error) {
      log.error(`Error tokenizing credit card: ${error}`)
      return null
    }
  }

  /**
   * Create a payment request with a tokenized credit card
   * Automatically handles 3DS authentication if required
   */
  async createPaymentRequestWithCard(
    data: CreatePaymentRequestV3 & {
      cardTokenId: string
      cardCvv?: string
      billingDetails?: {
        billingName?: string
        billingEmail?: string
        billingPhone?: string
      }
    },
  ): Promise<XenditPaymentRequestV3Response | null> {
    try {
      log.info(`Creating payment request with card token: ${data.cardTokenId}`)

      const requestBody = {
        reference_id: data.referenceId,
        type: 'PAY',
        country: data.country || 'ID',
        currency: data.currency || 'IDR',
        request_amount: data.requestAmount,
        capture_method: data.captureMethod || 'AUTOMATIC',
        channel_code: data.channelCode,
        channel_properties: {
          ...data.channelProperties,
          card_token_id: data.cardTokenId,
          ...(data.cardCvv && { card_cvv: data.cardCvv }),
          ...(data.billingDetails && { billing_details: data.billingDetails }),
          // Enable 3DS for additional security
          three_d_secure_enabled: true,
        },
        description: data.description,
        metadata: data.metadata,
      }

      const response = await fetch(`${this.baseUrl}/v3/payment_requests`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(requestBody),
      })

      const rawResult = (await response.json()) as any

      if (!response.ok) {
        const errorMessage =
          rawResult?.message || rawResult?.error_code || 'Unknown error'
        log.error(
          `Xendit card payment error: ${response.status} - ${JSON.stringify(rawResult)}`,
        )
        throw new Error(`Xendit card payment error: ${errorMessage}`)
      }

      const result = (rawResult?.data ??
        rawResult) as XenditPaymentRequestV3Response

      log.info(
        `Payment request with card created: ${result.id}, status: ${result.status}`,
      )
      return result
    } catch (error) {
      log.error(`Error creating payment request with card: ${error}`)
      return null
    }
  }

  /**
   * Complete 3DS authentication for a payment
   * Retrieves challenge details and prepares for OTP submission
   */
  async get3DSChallenge(
    paymentRequestId: string,
  ): Promise<{ challengeUrl?: string; challengeId?: string } | null> {
    try {
      log.info(`Retrieving 3DS challenge for payment: ${paymentRequestId}`)

      const response = await fetch(
        `${this.baseUrl}/v3/payment_requests/${paymentRequestId}`,
        {
          method: 'GET',
          headers: this.getHeaders(),
        },
      )

      const rawResult = (await response.json()) as any

      if (!response.ok) {
        log.error(
          `Error retrieving challenge: ${response.status} - ${JSON.stringify(rawResult)}`,
        )
        return null
      }

      const result = (rawResult?.data ??
        rawResult) as XenditPaymentRequestV3Response

      // Extract 3DS action from payment response
      const threeDsAction = result.actions?.find(
        (action: any) =>
          action.type === 'REDIRECT_CUSTOMER' &&
          action.descriptor === 'WEB_URL',
      )

      if (threeDsAction) {
        log.info(`3DS challenge URL obtained`)
        return {
          challengeUrl: threeDsAction.value,
          challengeId: result.id,
        }
      }

      return null
    } catch (error) {
      log.error(`Error getting 3DS challenge: ${error}`)
      return null
    }
  }

  /**
   * Complete 3DS authentication by submitting OTP or password
   * Verifies the 3DS challenge response
   */
  async complete3DSAuthentication(
    paymentRequestId: string,
    authToken: string,
  ): Promise<Authenticate3DSResponse | null> {
    try {
      log.info(`Completing 3DS authentication for payment: ${paymentRequestId}`)

      const requestBody = {
        authentication_token: authToken,
      }

      const response = await fetch(
        `${this.baseUrl}/v3/payment_requests/${paymentRequestId}/authenticate_3ds`,
        {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(requestBody),
        },
      )

      const rawResult = (await response.json()) as any

      if (!response.ok) {
        log.error(
          `3DS authentication failed: ${response.status} - ${JSON.stringify(rawResult)}`,
        )
        return {
          id: paymentRequestId,
          status: 'FAILED',
          message: rawResult?.message || 'Authentication failed',
        }
      }

      const result = (rawResult?.data ?? rawResult) as any

      log.info(`3DS authentication completed: ${result.status || 'SUCCESS'}`)
      return {
        id: result.id || paymentRequestId,
        status: result.status || 'SUCCEEDED',
        payment_id: result.payment_id,
        message: 'Authentication successful',
      }
    } catch (error) {
      log.error(`Error completing 3DS authentication: ${error}`)
      return {
        id: paymentRequestId,
        status: 'FAILED',
        message: `Authentication error: ${error}`,
      }
    }
  }
}

export const xenditService = new XenditService()
export default xenditService
