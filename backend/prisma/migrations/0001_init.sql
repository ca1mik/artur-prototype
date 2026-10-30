CREATE TABLE "User" (
    id SERIAL PRIMARY KEY,
    "telegramId" BIGINT NOT NULL UNIQUE,
    role TEXT NOT NULL,
    phone TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE TABLE "Region" (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE "Category" (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TYPE "UserRole" AS ENUM ('CUSTOMER','CARRIER','ADMIN');
CREATE TYPE "CarrierStatus" AS ENUM ('PENDING_APPROVAL','APPROVED','REJECTED','BANNED');
CREATE TYPE "OrderStatus" AS ENUM ('NEW','ACCEPTED','IN_PROGRESS','COMPLETED','CANCELLED');
CREATE TYPE "VehicleType" AS ENUM ('CAR','MINIVAN','MINIBUS','BUS','GAZELLE','TRUCK','TRAILER','SPECIAL');

ALTER TABLE "User" ALTER COLUMN role TYPE "UserRole" USING role::"UserRole";

CREATE TABLE "Customer" (
    id SERIAL PRIMARY KEY,
    "userId" INT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    CONSTRAINT "Customer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE
);

CREATE TABLE "Carrier" (
    id SERIAL PRIMARY KEY,
    "userId" INT NOT NULL UNIQUE,
    status "CarrierStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    capacity INT,
    "vehicleType" "VehicleType",
    "regionId" INT,
    brand TEXT,
    "plateNumber" TEXT,
    description TEXT,
    photos TEXT[] DEFAULT ARRAY[]::TEXT[],
    documents TEXT[] DEFAULT ARRAY[]::TEXT[],
    CONSTRAINT "Carrier_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE,
    CONSTRAINT "Carrier_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"(id)
);

CREATE TABLE "Vehicle" (
    id SERIAL PRIMARY KEY,
    "carrierId" INT NOT NULL,
    type "VehicleType" NOT NULL,
    brand TEXT NOT NULL,
    "plateNumber" TEXT NOT NULL,
    photos TEXT[] DEFAULT ARRAY[]::TEXT[],
    CONSTRAINT "Vehicle_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"(id) ON DELETE CASCADE
);

CREATE TABLE "Order" (
    id SERIAL PRIMARY KEY,
    "customerId" INT NOT NULL,
    "regionId" INT NOT NULL,
    "categoryId" INT NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    status "OrderStatus" NOT NULL DEFAULT 'NEW',
    "adultsCount" INT,
    "childrenCount" INT,
    "passengersCount" INT,
    "cargoDescription" TEXT,
    weight DOUBLE PRECISION,
    volume DOUBLE PRECISION,
    "routeFrom" TEXT NOT NULL,
    "routeTo" TEXT NOT NULL,
    date TIMESTAMP(3) NOT NULL,
    price DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
    "carrierId" INT,
    CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"(id) ON DELETE CASCADE,
    CONSTRAINT "Order_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"(id),
    CONSTRAINT "Order_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"(id),
    CONSTRAINT "Order_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"(id)
);

CREATE TABLE "Admin" (
    id SERIAL PRIMARY KEY,
    "userId" INT NOT NULL UNIQUE,
    CONSTRAINT "Admin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE
);
