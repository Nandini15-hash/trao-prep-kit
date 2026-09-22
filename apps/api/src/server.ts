import mongoose from "mongoose";
import { createApp } from "./app";
import { env } from "./lib/env";

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  // eslint-disable-next-line no-console
  console.log("Connected to MongoDB");

  const app = createApp();
  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on port ${env.PORT} (${env.NODE_ENV})`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server:", err);
  process.exit(1);
});
