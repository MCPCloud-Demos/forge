import { PrismaClient } from "@prisma/client";

import { config } from "./config";

// Prisma reads DATABASE_URL from the environment at client construction time;
// make sure the local-dev default is in place before the client is built.
process.env.DATABASE_URL = config.databaseUrl;

export const prisma = new PrismaClient();
