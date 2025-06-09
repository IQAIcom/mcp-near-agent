import { config } from "dotenv";
import { z } from "zod/v4";

config();

export const envSchema = z.object({
	DEBUG: z.stringbool().default(false),
	ACCOUNT_ID: z.string(),
	ACCOUNT_KEY: z.union([
		z.literal("ed25519:").brand<string>(),
		z.literal("secp256k1:").brand<string>(),
	]),
	PATH: z.string(),
	NEAR_NETWORK_ID: z.string().default("mainnet"),
	NEAR_NODE_URL: z.string().default("https://rpc.web4.near.page/account/near"),
	NEAR_GAS_LIMIT: z.string().default("300000000000000"),
});

export const env = envSchema.parse(process.env);
