import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const registrationSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
  legalName: z.string().trim().min(2).max(160),
  nickname: z.string().trim().min(2).max(32).regex(/^[A-Za-z0-9_\- ]+$/),
  phone: z.string().trim().min(7).max(32).optional(),
  dateOfBirth: z.string().date().optional(),
  csRole: z.enum(['IGL', 'AWPer', 'Rifler', 'Entry', 'Support', 'Lurker', 'Flexible']).optional(),
  identityRole: z.enum(['Soldier', 'Clan Leader', 'Host', 'Caster', 'Viewer']).optional(),
});

function formatNmd(value: number) {
  return `NMD-${String(value).padStart(6, '0')}`;
}

export async function POST(request: Request) {
  const parsed = registrationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_REGISTRATION', details: parsed.error.flatten() }, { status: 400 });
  }

  const input = parsed.data;
  const email = input.email.toLowerCase();
  const passwordHash = await bcrypt.hash(input.password, 12);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findFirst({
        where: { OR: [{ email }, { profile: { nickname: input.nickname } }] },
        select: { id: true },
      });
      if (existing) throw new Error('ACCOUNT_ALREADY_EXISTS');

      const sequence = await tx.identitySequence.upsert({
        where: { id: 'public-nmd' },
        create: { id: 'public-nmd', nextValue: 2 },
        update: { nextValue: { increment: 1 } },
      });
      const publicNmdId = formatNmd(sequence.nextValue - 1);

      return tx.user.create({
        data: {
          email,
          passwordHash,
          publicNmdId,
          accountStatus: 'UNVERIFIED',
          identity: {
            create: {
              legalName: input.legalName,
              phone: input.phone,
              dateOfBirth: input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00.000Z`) : undefined,
            },
          },
          profile: {
            create: {
              nickname: input.nickname,
              csRole: input.csRole,
              identityRole: input.identityRole,
              currentNr: 1000,
            },
          },
        },
        select: { publicNmdId: true, accountStatus: true },
      });
    });

    return NextResponse.json({
      status: 'ACCOUNT_CREATED_VERIFICATION_REQUIRED',
      player: created,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'ACCOUNT_ALREADY_EXISTS') {
      return NextResponse.json({ error: 'ACCOUNT_ALREADY_EXISTS' }, { status: 409 });
    }
    console.error('Registration failed', error);
    return NextResponse.json({ error: 'REGISTRATION_FAILED' }, { status: 500 });
  }
}
