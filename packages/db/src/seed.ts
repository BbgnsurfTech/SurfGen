/**
 * Development seed: demo org + admin user + starter project, avatar, voice,
 * and quota rows so a fresh stack is usable immediately.
 * Run: pnpm --filter @surfgen/db seed  (DATABASE_URL required)
 */
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const client = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

async function main(): Promise<void> {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'surfgen-dev-password';

  const user = await client.user.upsert({
    where: { email: 'admin@surfgen.local' },
    update: {},
    create: {
      email: 'admin@surfgen.local',
      name: 'SurfGen Admin',
      passwordHash: hashPassword(adminPassword),
      isSuperAdmin: true,
    },
  });

  const org = await client.organization.upsert({
    where: { slug: 'demo' },
    update: {},
    create: { name: 'Demo Organization', slug: 'demo', plan: 'pro' },
  });

  await client.membership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
    update: { role: 'owner' },
    create: { userId: user.id, organizationId: org.id, role: 'owner' },
  });

  const existingProject = await client.project.findFirst({
    where: { organizationId: org.id, name: 'Getting Started' },
  });
  if (!existingProject) {
    await client.project.create({
      data: {
        organizationId: org.id,
        name: 'Getting Started',
        description: 'Sample project created by the seed script',
      },
    });
  }

  const existingAvatar = await client.avatar.findFirst({
    where: { organizationId: org.id, name: 'Demo Presenter' },
  });
  if (!existingAvatar) {
    await client.avatar.create({
      data: {
        organizationId: org.id,
        name: 'Demo Presenter',
        kind: 'photo',
        providerId: 'avatar-mock',
        versions: { create: { version: 1, artifacts: {}, isActive: true } },
      },
    });
  }

  const existingVoice = await client.voice.findFirst({
    where: { organizationId: org.id, name: 'Amy (Local)' },
  });
  if (!existingVoice) {
    await client.voice.create({
      data: {
        organizationId: org.id,
        name: 'Amy (Local)',
        language: 'en-US',
        providerId: 'tts-piper',
        externalId: 'en_US-amy-medium',
      },
    });
  }

  for (const [metric, limit] of [
    ['render.seconds', 36_000],
    ['tts.characters', 5_000_000],
    ['llm.tokens', 10_000_000],
  ] as const) {
    await client.quota.upsert({
      where: { organizationId_metric: { organizationId: org.id, metric } },
      update: {},
      create: { organizationId: org.id, metric, limit, windowSeconds: 30 * 24 * 3600 },
    });
  }

  const apiKeyPlain = `sg_dev_${randomBytes(24).toString('hex')}`;
  await client.apiKey.upsert({
    where: { keyHash: createHash('sha256').update(apiKeyPlain).digest('hex') },
    update: {},
    create: {
      organizationId: org.id,
      userId: user.id,
      name: 'Dev key (seeded)',
      keyHash: createHash('sha256').update(apiKeyPlain).digest('hex'),
      keyPrefix: apiKeyPlain.slice(0, 10),
      scopes: ['*'],
    },
  });

  console.warn(`Seed complete.
  login:   admin@surfgen.local / ${adminPassword}
  api key: ${apiKeyPlain} (shown once — stored hashed)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => client.$disconnect());
