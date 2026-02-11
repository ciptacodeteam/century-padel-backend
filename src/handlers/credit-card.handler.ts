import { BadRequestException, NotFoundException } from '@/exceptions'
import { validateHook } from '@/helpers/validate-hook'
import { factory } from '@/lib/create-app'
import { db } from '@/lib/prisma'
import { ok, err } from '@/lib/response'
import {
  saveCreditCardSchema,
  SaveCreditCardSchema,
  updateCreditCardSchema,
  UpdateCreditCardSchema,
} from '@/lib/validation'
import { xenditService } from '@/services/xendit.service'
import { zValidator } from '@hono/zod-validator'
import status from 'http-status'
import { requireAuth } from '@/middlewares/auth'

/**
 * List all saved credit cards for the authenticated user
 */
export const listCreditCardsHandler = factory.createHandlers(
  requireAuth,
  async (c) => {
    try {
      const user = c.get('user')
      if (!user || !user.id) {
        return c.json(
          err('Unauthorized', status.UNAUTHORIZED),
          status.UNAUTHORIZED,
        )
      }

      const cards = await db.userCreditCard.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          cardBrand: true,
          last4: true,
          expMonth: true,
          expYear: true,
          isDefault: true,
          createdAt: true,
        },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      })

      return c.json(
        ok(
          {
            cards,
            total: cards.length,
          },
          'Credit cards retrieved',
        ),
      )
    } catch (err) {
      c.var.logger.fatal(`Error listing credit cards: ${err}`)
      throw err
    }
  },
)

/**
 * Get a specific credit card
 */
export const getCreditCardHandler = factory.createHandlers(
  requireAuth,
  async (c) => {
    try {
      const user = c.get('user')
      if (!user || !user.id) {
        return c.json(
          err('Unauthorized', status.UNAUTHORIZED),
          status.UNAUTHORIZED,
        )
      }

      const cardId = c.req.param('id')
      const card = await db.userCreditCard.findUnique({
        where: { id: cardId },
        select: {
          id: true,
          cardBrand: true,
          last4: true,
          expMonth: true,
          expYear: true,
          isDefault: true,
          createdAt: true,
          userId: true,
        },
      })

      if (!card) {
        throw new NotFoundException('Credit card not found')
      }

      if (card.userId !== user.id) {
        return c.json(
          err('Unauthorized access to card', status.FORBIDDEN),
          status.FORBIDDEN,
        )
      }

      return c.json(ok(card, 'Credit card retrieved'))
    } catch (err) {
      c.var.logger.fatal(`Error getting credit card: ${err}`)
      throw err
    }
  },
)

/**
 * Save a new credit card
 * Supports Cards Session JS token (recommended) or legacy tokenization
 */
export const saveCreditCardHandler = factory.createHandlers(
  requireAuth,
  zValidator('json', saveCreditCardSchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      if (!user || !user.id) {
        return c.json(
          err('Unauthorized', status.UNAUTHORIZED),
          status.UNAUTHORIZED,
        )
      }

      const validated = c.req.valid('json') as SaveCreditCardSchema
      const { isDefault } = validated

      let cardToken: string
      let cardBrand: string
      let last4: string
      let expMonth: number
      let expYear: number

      // Priority 1: Cards Session JS token (recommended)
      if (validated.cardToken) {
        if (
          !validated.cardBrand ||
          !validated.last4 ||
          !validated.expMonth ||
          !validated.expYear
        ) {
          throw new BadRequestException(
            'When using cardToken, you must provide cardBrand, last4, expMonth, and expYear',
          )
        }

        cardToken = validated.cardToken
        cardBrand = validated.cardBrand
        last4 = validated.last4
        expMonth = validated.expMonth
        expYear = validated.expYear
      }
      // Priority 2: Legacy tokenization
      else if (
        validated.cardNumber &&
        validated.cardholderName &&
        validated.cvv
      ) {
        const tokenResponse = await xenditService.tokenizeCreditCard({
          cardNumber: validated.cardNumber,
          cardholderName: validated.cardholderName,
          expiryMonth: validated.expiryMonth!,
          expiryYear: validated.expiryYear!,
          cvv: validated.cvv,
        })

        if (!tokenResponse || !tokenResponse.id) {
          throw new BadRequestException(
            'Failed to tokenize card. Please check your card details and try again.',
          )
        }

        cardToken = tokenResponse.id
        cardBrand = tokenResponse.card_brand || 'UNKNOWN'
        last4 = tokenResponse.card_number_last_four
        expMonth = tokenResponse.expiry_month
        expYear = tokenResponse.expiry_year
      } else {
        throw new BadRequestException(
          'Provide either cardToken with metadata, or cardNumber with cardholderName and cvv',
        )
      }

      // If this is to be the default, unset other defaults first
      if (isDefault) {
        await db.userCreditCard.updateMany({
          where: { userId: user.id, isDefault: true },
          data: { isDefault: false },
        })
      }

      // Check if card already saved (avoid duplicate)
      const existingCard = await db.userCreditCard.findUnique({
        where: { cardToken },
      })

      if (existingCard) {
        if (existingCard.userId !== user.id) {
          throw new BadRequestException(
            'Card already registered to another user',
          )
        }
        return c.json(
          ok(
            {
              id: existingCard.id,
              cardBrand: existingCard.cardBrand,
              last4: existingCard.last4,
              expMonth: existingCard.expMonth,
              expYear: existingCard.expYear,
              isDefault: existingCard.isDefault,
              createdAt: existingCard.createdAt,
            },
            'Card already saved',
          ),
        )
      }

      // Save card metadata to database
      const card = await db.userCreditCard.create({
        data: {
          userId: user.id,
          cardToken,
          cardBrand,
          last4,
          expMonth,
          expYear,
          isDefault: isDefault || false,
        },
        select: {
          id: true,
          cardBrand: true,
          last4: true,
          expMonth: true,
          expYear: true,
          isDefault: true,
          createdAt: true,
        },
      })

      return c.json(ok(card, 'Credit card saved successfully'), status.CREATED)
    } catch (err) {
      c.var.logger.fatal(`Error saving credit card: ${err}`)
      throw err
    }
  },
)

/**
 * Update credit card (mark as default, etc.)
 */
export const updateCreditCardHandler = factory.createHandlers(
  requireAuth,
  zValidator('json', updateCreditCardSchema, validateHook),
  async (c) => {
    try {
      const user = c.get('user')
      if (!user || !user.id) {
        return c.json(
          err('Unauthorized', status.UNAUTHORIZED),
          status.UNAUTHORIZED,
        )
      }

      const cardId = c.req.param('id')
      const validated = c.req.valid('json') as UpdateCreditCardSchema
      const { isDefault } = validated

      // Verify card belongs to user
      const card = await db.userCreditCard.findUnique({
        where: { id: cardId },
        select: { userId: true },
      })

      if (!card) {
        throw new NotFoundException('Credit card not found')
      }

      if (card.userId !== user.id) {
        return c.json(
          err('Unauthorized access to card', status.FORBIDDEN),
          status.FORBIDDEN,
        )
      }

      // If marking as default, unset others
      if (isDefault) {
        await db.userCreditCard.updateMany({
          where: { userId: user.id, isDefault: true },
          data: { isDefault: false },
        })
      }

      // Update card
      const updatedCard = await db.userCreditCard.update({
        where: { id: cardId },
        data: { isDefault },
        select: {
          id: true,
          cardBrand: true,
          last4: true,
          expMonth: true,
          expYear: true,
          isDefault: true,
          createdAt: true,
        },
      })

      return c.json(ok(updatedCard, 'Credit card updated'))
    } catch (err) {
      c.var.logger.fatal(`Error updating credit card: ${err}`)
      throw err
    }
  },
)

/**
 * Delete a credit card
 */
export const deleteCreditCardHandler = factory.createHandlers(
  requireAuth,
  async (c) => {
    try {
      const user = c.get('user')
      if (!user || !user.id) {
        return c.json(
          err('Unauthorized', status.UNAUTHORIZED),
          status.UNAUTHORIZED,
        )
      }

      const cardId = c.req.param('id')

      // Verify card belongs to user
      const card = await db.userCreditCard.findUnique({
        where: { id: cardId },
        select: { userId: true },
      })

      if (!card) {
        throw new NotFoundException('Credit card not found')
      }

      if (card.userId !== user.id) {
        return c.json(
          err('Unauthorized access to card', status.FORBIDDEN),
          status.FORBIDDEN,
        )
      }

      // Delete card
      await db.userCreditCard.delete({
        where: { id: cardId },
      })

      return c.json(ok(null, 'Credit card deleted'))
    } catch (err) {
      c.var.logger.fatal(`Error deleting credit card: ${err}`)
      throw err
    }
  },
)
