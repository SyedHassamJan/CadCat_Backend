import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as any);

  // Seed admin user
  const email = process.env.ADMIN_EMAIL || 'admin@cadmarketplace.com';
  const password = process.env.ADMIN_PASSWORD || 'Admin@123456';

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (!existing) {
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.adminUser.create({
      data: { email, passwordHash, role: 'admin' },
    });
    console.log(`✅ Admin user created: ${email}`);
  } else {
    console.log(`ℹ️  Admin user already exists: ${email}`);
  }

  // Seed initial categories
  const categories = [
    { name: 'Architecture', slug: 'architecture' },
    { name: 'Furniture', slug: 'furniture' },
    { name: 'Electrical', slug: 'electrical' },
    { name: 'Mechanical', slug: 'mechanical' },
    { name: 'Landscape', slug: 'landscape' },
    { name: 'Structural', slug: 'structural' },
    { name: 'Plumbing', slug: 'plumbing' },
    { name: 'HVAC', slug: 'hvac' },
  ];

  for (const cat of categories) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {},
      create: cat,
    });
  }
  console.log('✅ Categories seeded (8 defaults).');

  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
