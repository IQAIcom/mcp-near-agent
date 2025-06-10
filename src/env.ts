import { config } from "dotenv";
import { z } from "zod/v4";

config();

type KeyPairString = `ed25519:${string}` | `secp256k1:${string}`;

const keyPairSchema = z.custom<KeyPairString>(
	(val) => {
		if (typeof val !== "string") return false;
		return val.startsWith("ed25519:") || val.startsWith("secp256k1:");
	},
	{
		message: "ACCOUNT_KEY must start with 'ed25519:' or 'secp256k1:'",
	},
);

export const envSchema = z.object({
	DEBUG: z.stringbool().default(false),
	ACCOUNT_ID: z.string(),
	ACCOUNT_KEY: keyPairSchema,
	PATH: z.string(),
	NEAR_NETWORK_ID: z.string().default("mainnet"),
	NEAR_NODE_URL: z.string().default("https://1rpc.io/near"),
	NEAR_GAS_LIMIT: z.string().default("300000000000000"),
});

export const env = envSchema.parse(process.env);
