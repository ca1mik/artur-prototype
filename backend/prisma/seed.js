import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
    const regions = ["Казань", "Самара", "Уфа"];
    const categories = [
        "Межгород",
        "Город",
        "Трансфер",
        "Корпоративная перевозка",
        "Туризм",
        "Доставка груза",
        "Перевозка техники",
        "Срочный заказ",
    ];
    const pricingRules = [
        { vehicleType: "CAR", basePrice: 300, pricePerKm: 20, pricePerHour: 450, minPrice: 1200 },
        { vehicleType: "MINIVAN", basePrice: 500, pricePerKm: 28, pricePerHour: 650, minPrice: 1800 },
        { vehicleType: "MINIBUS", basePrice: 800, pricePerKm: 38, pricePerHour: 900, minPrice: 2800 },
        { vehicleType: "BUS", basePrice: 1200, pricePerKm: 55, pricePerHour: 1400, minPrice: 4500 },
        { vehicleType: "GAZELLE", basePrice: 600, pricePerKm: 26, pricePerHour: 700, minPrice: 2000 },
        { vehicleType: "TRUCK", basePrice: 900, pricePerKm: 40, pricePerHour: 1100, minPrice: 3200 },
        { vehicleType: "TRAILER", basePrice: 1500, pricePerKm: 60, pricePerHour: 1700, minPrice: 5200 },
        { vehicleType: "SPECIAL", basePrice: 2000, pricePerKm: 75, pricePerHour: 2200, minPrice: 7000 },
    ];
    for (const name of regions) {
        await prisma.region.upsert({
            where: { name },
            update: {},
            create: { name },
        });
    }
    for (const name of categories) {
        await prisma.category.upsert({
            where: { name },
            update: {},
            create: { name },
        });
    }
    for (const rule of pricingRules) {
        await prisma.pricingRule.upsert({
            where: { vehicleType: rule.vehicleType },
            update: rule,
            create: rule,
        });
    }
    const adminTelegramId = process.env.ADMIN_TELEGRAM_ID ? Number(process.env.ADMIN_TELEGRAM_ID) : null;
    if (adminTelegramId) {
        const user = await prisma.user.findUnique({ where: { telegramId: adminTelegramId } });
        if (user) {
            await prisma.admin.upsert({
                where: { userId: user.id },
                update: {},
                create: { userId: user.id },
            });
        }
    }
}
main()
    .then(() => {
    console.log("Seed finished");
    return prisma.$disconnect();
})
    .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
});
//# sourceMappingURL=seed.js.map