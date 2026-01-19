-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderNumber" TEXT,
    "lineItemCount" INTEGER,
    "status" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "OrderLineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "Products" (
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "variantTitle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sku" TEXT,
    "fulfillmentServiceId" TEXT NOT NULL,

    PRIMARY KEY ("productId", "variantId")
);

-- CreateTable
CREATE TABLE "ShopSetup" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "step1Completed" BOOLEAN NOT NULL DEFAULT false,
    "step2Completed" BOOLEAN NOT NULL DEFAULT false,
    "carrierServiceId" TEXT,
    "fulfillmentServiceId" TEXT,
    "orderWebhookId" TEXT
);
