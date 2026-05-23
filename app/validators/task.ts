import vine from '@vinejs/vine'

export const createTaskValidator = vine.compile(
  vine.object({
    intent: vine.string().minLength(1).maxLength(64),
    payload: vine.any().optional(),
    idempotencyKey: vine.string().maxLength(128).optional(),
  })
)
