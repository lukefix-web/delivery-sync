-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "shopifyFulfillmentId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderName" TEXT NOT NULL,
    "trackingNumber" TEXT NOT NULL,
    "trackingCompany" TEXT,
    "shopifyFulfillmentStatus" TEXT,
    "dhlStatus" TEXT,
    "dhlStatusCode" TEXT,
    "dhlDelivered" BOOLEAN NOT NULL DEFAULT false,
    "dhlDeliveredAt" DATETIME,
    "shopifyDelivered" BOOLEAN NOT NULL DEFAULT false,
    "shopifyDeliveredAt" DATETIME,
    "lastCheckedAt" DATETIME,
    "nextCheckAt" DATETIME,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Shipment_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "lastImportAt" DATETIME,
    "lastSyncAt" DATETIME,
    "lastSyncOk" BOOLEAN,
    "lastSyncMessage" TEXT,
    "lockedUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SyncState_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Shipment_shopId_shopifyDelivered_nextCheckAt_idx" ON "Shipment"("shopId", "shopifyDelivered", "nextCheckAt");

-- CreateIndex
CREATE INDEX "Shipment_shopId_shopifyOrderId_idx" ON "Shipment"("shopId", "shopifyOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_shopId_shopifyFulfillmentId_trackingNumber_key" ON "Shipment"("shopId", "shopifyFulfillmentId", "trackingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SyncState_shopId_key" ON "SyncState"("shopId");

-- CreateIndex
CREATE INDEX "AppLog_shopId_createdAt_idx" ON "AppLog"("shopId", "createdAt");
