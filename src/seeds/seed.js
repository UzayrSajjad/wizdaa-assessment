/**
 * Seed script — populates the database with realistic test data.
 * Run with: npm run seed
 */
require('reflect-metadata');
const { DataSource } = require('typeorm');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { getDatabaseConfig } = require('../config/database.config');

const EMPLOYEES = [
    {
        id: uuidv4(),
        externalHcmId: 'HCM-EMP-001',
        email: 'john.doe@company.com',
        firstName: 'John',
        lastName: 'Doe',
        department: 'Engineering',
        locationCode: 'US',
        isActive: true,
    },
    {
        id: uuidv4(),
        externalHcmId: 'HCM-EMP-002',
        email: 'jane.smith@company.com',
        firstName: 'Jane',
        lastName: 'Smith',
        department: 'Product',
        locationCode: 'US',
        isActive: true,
    },
    {
        id: uuidv4(),
        externalHcmId: 'HCM-EMP-003',
        email: 'ahmed.khan@company.com',
        firstName: 'Ahmed',
        lastName: 'Khan',
        department: 'Engineering',
        locationCode: 'PK',
        isActive: true,
    },
    {
        id: uuidv4(),
        externalHcmId: 'HCM-EMP-004',
        email: 'lisa.chen@company.com',
        firstName: 'Lisa',
        lastName: 'Chen',
        department: 'Design',
        locationCode: 'SG',
        isActive: true,
    },
];

const LEAVE_TYPES = ['ANNUAL', 'SICK', 'PERSONAL'];

async function seed() {
    console.log('🌱 Starting database seed...\n');

    const config = getDatabaseConfig();
    const dataSource = new DataSource({
        ...config,
        entities: [
            path.join(__dirname, '..', 'modules', '**', '*.entity.js'),
        ],
        synchronize: true,
    });

    await dataSource.initialize();
    console.log('✅ Database connection established\n');

    const employeeRepo = dataSource.getRepository('Employee');
    const balanceRepo = dataSource.getRepository('LeaveBalance');

    // Seed employees
    console.log('👥 Seeding employees...');
    for (const emp of EMPLOYEES) {
        const exists = await employeeRepo.findOne({ where: { email: emp.email } });
        if (!exists) {
            await employeeRepo.save(emp);
            console.log(`   ✅ Created: ${emp.firstName} ${emp.lastName} (${emp.email})`);
        } else {
            emp.id = exists.id;
            console.log(`   ⏭️  Exists: ${emp.firstName} ${emp.lastName}`);
        }
    }

    // Seed balances
    console.log('\n💰 Seeding leave balances...');
    const balanceDefaults = {
        ANNUAL: { total: 20, used: 3 },
        SICK: { total: 10, used: 1 },
        PERSONAL: { total: 5, used: 0 },
    };

    for (const emp of EMPLOYEES) {
        for (const leaveType of LEAVE_TYPES) {
            const exists = await balanceRepo.findOne({
                where: { employeeId: emp.id, leaveType },
            });
            if (!exists) {
                await balanceRepo.save({
                    id: uuidv4(),
                    employeeId: emp.id,
                    leaveType,
                    locationId: emp.locationCode,
                    totalDays: balanceDefaults[leaveType].total,
                    usedDays: balanceDefaults[leaveType].used,
                    pendingDays: 0,
                    syncSource: 'HCM_BATCH',
                    lastSyncedAt: new Date(),
                });
                console.log(`   ✅ ${emp.firstName}: ${leaveType} = ${balanceDefaults[leaveType].total} total, ${balanceDefaults[leaveType].used} used`);
            } else {
                console.log(`   ⏭️  ${emp.firstName}: ${leaveType} already exists`);
            }
        }
    }

    console.log('\n✅ Seeding complete!');
    console.log('\n📋 Employee IDs for testing:');
    for (const emp of EMPLOYEES) {
        console.log(`   ${emp.firstName} ${emp.lastName}: ${emp.id}`);
    }

    await dataSource.destroy();
}

seed().catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
});
