import { Schema, model, InferSchemaType, Types } from "mongoose";
import type { Kit as KitData } from "@trao/shared";

/**
 * Persistence envelope around a Kit. The kit's own structure is owned by
 * the Zod schema in @trao/shared (Appendix A) — that's the single source
 * of truth for validation, run in the service layer before every save
 * (see services/kit.service.ts). Mongoose only needs to know the fields
 * it must query/index on (owner, status, timestamps); the kit body itself
 * is stored as a validated plain object rather than re-declared as a
 * parallel Mongoose schema, so the two shapes can't drift apart.
 */
const kitDocumentSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: {
      type: String,
      enum: ["pending", "generating", "ready", "failed"],
      required: true,
      default: "pending",
    },
    // Set once generation has produced a structurally-valid kit.
    data: { type: Schema.Types.Mixed, default: null },
    // Populated when status === "failed"; structured like Appendix B's error.
    error: {
      code: { type: String },
      message: { type: String },
    },
    // Progress trail shown to the user while generation runs (Section 12:
    // "Show clear loading ... states while a kit is being generated").
    progress: [
      {
        step: { type: String, required: true },
        status: { type: String, enum: ["running", "done", "skipped", "failed"], required: true },
        detail: { type: String },
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

export type KitDoc = InferSchemaType<typeof kitDocumentSchema> & {
  _id: Types.ObjectId;
  data: KitData | null;
};

export const KitDocument = model("Kit", kitDocumentSchema);
