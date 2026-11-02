import { z } from 'zod';

/** Coordinates refer to the oriented, resized image; the origin is its top left corner. */
export const ocrBoxSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1),
  })
  .strict()
  .refine((box) => box.x + box.width <= 1.000001 && box.y + box.height <= 1.000001, 'Fragment poza obrazem.');

export const ocrLineSchema = z
  .object({
    id: z.string().min(1).max(200),
    text: z.string().max(10000),
    box: ocrBoxSchema,
    // Adapter-local block identifiers are optional, never shared across OCR runs.
    blockId: z.string().min(1).max(200).optional(),
    confidence: z.number().finite().min(0).max(100).optional(),
  })
  .strict();

export const ocrDocumentSchema = z
  .object({
    image: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
    lines: z.array(ocrLineSchema).max(10000),
  })
  .strict()
  .refine((document) => new Set(document.lines.map((line) => line.id)).size === document.lines.length, {
    message: 'Identyfikatory fragmentów muszą być unikalne.',
    path: ['lines'],
  });

export type OcrBox = z.infer<typeof ocrBoxSchema>;
export type OcrLine = z.infer<typeof ocrLineSchema>;
export type OcrDocument = z.infer<typeof ocrDocumentSchema>;
