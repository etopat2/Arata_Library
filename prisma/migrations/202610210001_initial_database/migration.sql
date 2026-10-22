-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "app";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "research";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "research_private";

-- CreateEnum
CREATE TYPE "app"."UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "app"."AuthenticatorKind" AS ENUM ('PASSWORD', 'TOTP', 'PASSKEY', 'RECOVERY_CODE');

-- CreateEnum
CREATE TYPE "app"."PublicationKind" AS ENUM ('STANDALONE', 'SERIES');

-- CreateEnum
CREATE TYPE "app"."PublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "app"."RevisionStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "app"."ReviewDecision" AS ENUM ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "app"."AssetStatus" AS ENUM ('QUARANTINED', 'SCANNING', 'CLEAN', 'REJECTED');

-- CreateEnum
CREATE TYPE "app"."AccessClass" AS ENUM ('PUBLIC_FREE', 'REGISTERED_FREE', 'PREMIUM', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "app"."EntitlementSource" AS ENUM ('PAID', 'TRIAL', 'INSTITUTION', 'COMPLIMENTARY', 'SPONSORED');

-- CreateEnum
CREATE TYPE "app"."EntitlementStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "app"."SubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "app"."OrderStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "app"."PaymentStatus" AS ENUM ('INITIATED', 'PENDING', 'VERIFIED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "app"."RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'SUBMITTED', 'SETTLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "app"."InstitutionStatus" AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "app"."MembershipStatus" AS ENUM ('PENDING', 'VERIFIED', 'SUSPENDED', 'EXPIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "app"."ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "app"."AttemptStatus" AS ENUM ('STARTED', 'SUBMITTED', 'GRADED');

-- CreateEnum
CREATE TYPE "app"."NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "app"."SubjectRequestStatus" AS ENUM ('OPEN', 'VERIFYING', 'PROCESSING', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "app"."EntitlementScope" AS ENUM ('LIBRARY', 'PUBLICATION', 'VOLUME', 'EDITION', 'RESOURCE');

-- CreateEnum
CREATE TYPE "research"."ResearchReportStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'RELEASED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "research"."ResearchStudyStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAUSED', 'CLOSED');

-- CreateTable
CREATE TABLE "app"."User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "passwordHash" VARCHAR(255),
    "status" "app"."UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "emailVerifiedAt" TIMESTAMPTZ(6),
    "termsAcceptedAt" TIMESTAMPTZ(6) NOT NULL,
    "privacyVersion" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."UserProfile" (
    "userId" UUID NOT NULL,
    "displayName" VARCHAR(200),
    "locale" VARCHAR(32) NOT NULL DEFAULT 'en-GB',
    "timezone" VARCHAR(80) NOT NULL DEFAULT 'UTC',
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "app"."AuthSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "mfaVerifiedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Authenticator" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "app"."AuthenticatorKind" NOT NULL,
    "credentialHash" VARCHAR(512) NOT NULL,
    "lastUsedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Authenticator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."VerificationToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" VARCHAR(64) NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Role" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "description" TEXT,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Permission" (
    "id" UUID NOT NULL,
    "code" VARCHAR(120) NOT NULL,
    "description" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."RolePermission" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "app"."RoleAssignment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "scopeType" VARCHAR(32) NOT NULL DEFAULT 'PLATFORM',
    "scopeId" UUID,
    "startsAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),

    CONSTRAINT "RoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."ProcessingPurpose" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "description" TEXT NOT NULL,
    "lawfulBasis" VARCHAR(120) NOT NULL,
    "optional" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProcessingPurpose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."PrivacyPreference" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purposeId" UUID NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "policyVersion" VARCHAR(64) NOT NULL,
    "effectiveAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMPTZ(6),

    CONSTRAINT "PrivacyPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."SubjectRequest" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "requestType" VARCHAR(40) NOT NULL,
    "status" "app"."SubjectRequestStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT,
    "requestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(6),

    CONSTRAINT "SubjectRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."RetentionPolicy" (
    "id" UUID NOT NULL,
    "purposeId" UUID NOT NULL,
    "dataClass" VARCHAR(80) NOT NULL,
    "days" INTEGER,
    "legalBasis" TEXT NOT NULL,
    "approvedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Collection" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."PublicationCollection" (
    "publicationId" UUID NOT NULL,
    "collectionId" UUID NOT NULL,

    CONSTRAINT "PublicationCollection_pkey" PRIMARY KEY ("publicationId","collectionId")
);

-- CreateTable
CREATE TABLE "app"."Publication" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "title" VARCHAR(400) NOT NULL,
    "kind" "app"."PublicationKind" NOT NULL,
    "status" "app"."PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "ownerId" UUID NOT NULL,
    "copyrightNotice" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Volume" (
    "id" UUID NOT NULL,
    "publicationId" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "title" VARCHAR(400) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Volume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Edition" (
    "id" UUID NOT NULL,
    "publicationId" UUID NOT NULL,
    "volumeId" UUID,
    "editionCode" VARCHAR(60) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "currentRevisionId" UUID,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Edition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Revision" (
    "id" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "app"."RevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "manifestHash" VARCHAR(128),
    "changeSummary" TEXT,
    "publishedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Chapter" (
    "id" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "title" VARCHAR(400) NOT NULL,

    CONSTRAINT "Chapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Lesson" (
    "id" UUID NOT NULL,
    "chapterId" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "title" VARCHAR(400) NOT NULL,
    "bodyAssetId" UUID,
    "contentHash" VARCHAR(128),

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Asset" (
    "id" UUID NOT NULL,
    "uploadedById" UUID NOT NULL,
    "storageKey" VARCHAR(500) NOT NULL,
    "originalName" VARCHAR(400) NOT NULL,
    "mimeType" VARCHAR(160) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "status" "app"."AssetStatus" NOT NULL DEFAULT 'QUARANTINED',
    "scanEvidence" JSONB,
    "scannedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Resource" (
    "id" UUID NOT NULL,
    "title" VARCHAR(400) NOT NULL,
    "accessClass" "app"."AccessClass" NOT NULL DEFAULT 'RESTRICTED',
    "licenceCode" VARCHAR(100) NOT NULL,
    "publishedAt" TIMESTAMPTZ(6),
    "withdrawnAt" TIMESTAMPTZ(6),
    "publicationId" UUID,
    "volumeId" UUID,
    "editionId" UUID,
    "revisionId" UUID,
    "chapterId" UUID,
    "lessonId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."ResourceAttachment" (
    "resourceId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ResourceAttachment_pkey" PRIMARY KEY ("resourceId","assetId")
);

-- CreateTable
CREATE TABLE "app"."EditorialReview" (
    "id" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "decision" "app"."ReviewDecision" NOT NULL,
    "manifestHash" VARCHAR(128) NOT NULL,
    "comment" TEXT,
    "decidedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EditorialReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."ContentPolicy" (
    "id" UUID NOT NULL,
    "publicationId" UUID,
    "volumeId" UUID,
    "editionId" UUID,
    "revisionId" UUID,
    "chapterId" UUID,
    "lessonId" UUID,
    "resourceId" UUID,
    "accessClass" "app"."AccessClass",
    "allowRead" BOOLEAN,
    "allowDownload" BOOLEAN,
    "allowCopy" BOOLEAN,
    "allowPrint" BOOLEAN,
    "allowOffline" BOOLEAN,
    "allowShare" BOOLEAN,
    "watermark" BOOLEAN,
    "version" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."PolicyChange" (
    "id" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "beforeHash" VARCHAR(128),
    "afterHash" VARCHAR(128) NOT NULL,
    "reason" TEXT NOT NULL,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Plan" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."PlanVersion" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "currencyCode" VARCHAR(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "periodMonths" INTEGER,
    "scopeKind" VARCHAR(32) NOT NULL,
    "scopeId" UUID,
    "termsHash" VARCHAR(128) NOT NULL,
    "validFrom" TIMESTAMPTZ(6) NOT NULL,
    "validUntil" TIMESTAMPTZ(6),

    CONSTRAINT "PlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Subscription" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "planVersionId" UUID NOT NULL,
    "status" "app"."SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "currentPeriodStart" TIMESTAMPTZ(6),
    "currentPeriodEnd" TIMESTAMPTZ(6),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."TrialUsage" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "campaignKey" VARCHAR(100) NOT NULL,
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TrialUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Order" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "planVersionId" UUID NOT NULL,
    "merchantRef" VARCHAR(120) NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "currencyCode" VARCHAR(3) NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "status" "app"."OrderStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMPTZ(6),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."PaymentAttempt" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "provider" VARCHAR(80) NOT NULL,
    "providerRef" VARCHAR(160),
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currencyCode" VARCHAR(3) NOT NULL,
    "status" "app"."PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "verifiedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."GatewayEvent" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(80) NOT NULL,
    "providerEventId" VARCHAR(200) NOT NULL,
    "paymentAttemptId" UUID,
    "payloadHash" VARCHAR(128) NOT NULL,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(6),

    CONSTRAINT "GatewayEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Invoice" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "invoiceNumber" VARCHAR(120) NOT NULL,
    "currencyCode" VARCHAR(3) NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "issuedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Refund" (
    "id" UUID NOT NULL,
    "paymentAttemptId" UUID NOT NULL,
    "providerRefundId" VARCHAR(160),
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "status" "app"."RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "approvedAt" TIMESTAMPTZ(6),
    "settledAt" TIMESTAMPTZ(6),

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."ReconciliationRun" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(80) NOT NULL,
    "periodFrom" TIMESTAMPTZ(6) NOT NULL,
    "periodTo" TIMESTAMPTZ(6) NOT NULL,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."ReconciliationItem" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "paymentAttemptId" UUID,
    "providerRef" VARCHAR(160) NOT NULL,
    "outcome" VARCHAR(40) NOT NULL,
    "detail" JSONB,

    CONSTRAINT "ReconciliationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Entitlement" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "source" "app"."EntitlementSource" NOT NULL,
    "status" "app"."EntitlementStatus" NOT NULL DEFAULT 'PENDING',
    "scope" "app"."EntitlementScope" NOT NULL,
    "publicationId" UUID,
    "volumeId" UUID,
    "editionId" UUID,
    "resourceId" UUID,
    "orderId" UUID,
    "subscriptionId" UUID,
    "trialUsageId" UUID,
    "membershipId" UUID,
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Entitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."EntitlementEvent" (
    "id" UUID NOT NULL,
    "entitlementId" UUID NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "reason" TEXT,
    "actorId" UUID,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntitlementEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."GrantApproval" (
    "id" UUID NOT NULL,
    "entitlementId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "approvedById" UUID,
    "status" "app"."ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "requestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMPTZ(6),

    CONSTRAINT "GrantApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Institution" (
    "id" UUID NOT NULL,
    "legalName" VARCHAR(400) NOT NULL,
    "status" "app"."InstitutionStatus" NOT NULL DEFAULT 'PENDING',
    "verificationMode" VARCHAR(80) NOT NULL,
    "approvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."InstitutionDomain" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "domain" VARCHAR(253) NOT NULL,
    "ownershipProofHash" VARCHAR(128),
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(6),
    "verifiedAt" TIMESTAMPTZ(6),
    "suspendedAt" TIMESTAMPTZ(6),
    "reviewDueAt" TIMESTAMPTZ(6),

    CONSTRAINT "InstitutionDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Membership" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "app"."MembershipStatus" NOT NULL DEFAULT 'PENDING',
    "verificationMethod" VARCHAR(80) NOT NULL,
    "evidenceRef" TEXT,
    "verifiedAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."EligibilityPolicy" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "scope" "app"."EntitlementScope" NOT NULL,
    "scopeId" UUID,
    "verificationMode" VARCHAR(80) NOT NULL,
    "validityDays" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "EligibilityPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."EligibilityReview" (
    "id" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "decision" "app"."ApprovalStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "reviewedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EligibilityReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Cohort" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cohort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."CohortMember" (
    "cohortId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "joinedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMPTZ(6),

    CONSTRAINT "CohortMember_pkey" PRIMARY KEY ("cohortId","userId")
);

-- CreateTable
CREATE TABLE "app"."ReadingProgress" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "lessonId" UUID NOT NULL,
    "position" JSONB,
    "completedAt" TIMESTAMPTZ(6),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ReadingProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Bookmark" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "anchor" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bookmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Annotation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "anchor" VARCHAR(500) NOT NULL,
    "encryptedBodyRef" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Annotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Quiz" (
    "id" UUID NOT NULL,
    "lessonId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "publishedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Quiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."QuizQuestion" (
    "id" UUID NOT NULL,
    "quizId" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "promptAssetId" UUID,
    "answerSpec" JSONB NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "QuizQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."QuizAttempt" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "quizId" UUID NOT NULL,
    "status" "app"."AttemptStatus" NOT NULL DEFAULT 'STARTED',
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMPTZ(6),
    "score" DECIMAL(8,2),

    CONSTRAINT "QuizAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."QuizAnswer" (
    "attemptId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "response" JSONB NOT NULL,
    "awarded" DECIMAL(8,2),

    CONSTRAINT "QuizAnswer_pkey" PRIMARY KEY ("attemptId","questionId")
);

-- CreateTable
CREATE TABLE "app"."Project" (
    "id" UUID NOT NULL,
    "lessonId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "briefAssetId" UUID,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."ProjectSubmission" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "submittedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(40) NOT NULL,

    CONSTRAINT "ProjectSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."OfflineLicence" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "editionId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "deviceHash" VARCHAR(128) NOT NULL,
    "manifestHash" VARCHAR(128) NOT NULL,
    "issuedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),

    CONSTRAINT "OfflineLicence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."SyncOperation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceHash" VARCHAR(128) NOT NULL,
    "clientOperationId" VARCHAR(160) NOT NULL,
    "operationType" VARCHAR(80) NOT NULL,
    "payloadHash" VARCHAR(128) NOT NULL,
    "result" JSONB,
    "processedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" VARCHAR(80) NOT NULL,
    "status" "app"."NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "templateCode" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(6),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."ApprovalRequest" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(80) NOT NULL,
    "objectId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "decidedById" UUID,
    "status" "app"."ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "requestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."AuditEvent" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" VARCHAR(120) NOT NULL,
    "objectType" VARCHAR(80) NOT NULL,
    "objectId" UUID,
    "beforeHash" VARCHAR(128),
    "afterHash" VARCHAR(128),
    "correlationId" VARCHAR(120) NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."OutboxEvent" (
    "id" UUID NOT NULL,
    "aggregateType" VARCHAR(80) NOT NULL,
    "aggregateId" UUID NOT NULL,
    "eventType" VARCHAR(120) NOT NULL,
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(6),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_private"."PseudonymLink" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "pseudonym" VARCHAR(128) NOT NULL,
    "keyVersion" VARCHAR(40) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMPTZ(6),

    CONSTRAINT "PseudonymLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research"."ResearchSession" (
    "id" UUID NOT NULL,
    "pseudonym" VARCHAR(128) NOT NULL,
    "startedAt" TIMESTAMPTZ(6) NOT NULL,
    "endedAt" TIMESTAMPTZ(6),
    "visibleSeconds" INTEGER NOT NULL DEFAULT 0,
    "engagedSeconds" INTEGER NOT NULL DEFAULT 0,
    "methodVersion" VARCHAR(40) NOT NULL,

    CONSTRAINT "ResearchSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research"."ResearchEvent" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "pseudonym" VARCHAR(128) NOT NULL,
    "sessionId" UUID,
    "purposeId" UUID NOT NULL,
    "publicationId" UUID,
    "revisionId" UUID,
    "eventType" VARCHAR(100) NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "eventAt" TIMESTAMPTZ(6) NOT NULL,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retentionUntil" TIMESTAMPTZ(6) NOT NULL,
    "consentVersion" VARCHAR(64),
    "properties" JSONB NOT NULL,

    CONSTRAINT "ResearchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research"."ResearchMetric" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "version" INTEGER NOT NULL,
    "formula" TEXT NOT NULL,
    "timezone" VARCHAR(80) NOT NULL,
    "approvedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ResearchMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research"."ResearchAggregate" (
    "id" UUID NOT NULL,
    "metricId" UUID NOT NULL,
    "periodStart" TIMESTAMPTZ(6) NOT NULL,
    "periodEnd" TIMESTAMPTZ(6) NOT NULL,
    "dimensionsHash" VARCHAR(128) NOT NULL,
    "dimensions" JSONB NOT NULL,
    "value" DECIMAL(20,6) NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "computedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research"."ResearchStudy" (
    "id" UUID NOT NULL,
    "protocolVersion" VARCHAR(60) NOT NULL,
    "question" TEXT NOT NULL,
    "status" "research"."ResearchStudyStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchStudy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research"."ResearchReport" (
    "id" UUID NOT NULL,
    "studyId" UUID,
    "metricVersion" VARCHAR(60) NOT NULL,
    "snapshotKey" VARCHAR(500) NOT NULL,
    "status" "research"."ResearchReportStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research"."DisclosureReview" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "decision" "app"."ApprovalStatus" NOT NULL,
    "minimumGroupSize" INTEGER NOT NULL,
    "suppressionProof" JSONB NOT NULL,
    "differencingProof" JSONB NOT NULL,
    "reviewedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisclosureReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research"."PublicInsight" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "publishedById" UUID NOT NULL,
    "exceptionApprovalId" UUID,
    "snapshotKey" VARCHAR(500) NOT NULL,
    "minimumGroupSize" INTEGER NOT NULL,
    "publishedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMPTZ(6),

    CONSTRAINT "PublicInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research"."ResearchExport" (
    "id" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research"."ResearchDisclosurePolicy" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "minimumGroupSize" INTEGER NOT NULL,
    "suppressionRule" TEXT NOT NULL,
    "approvedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ResearchDisclosurePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research"."ResearchAudit" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" VARCHAR(120) NOT NULL,
    "objectType" VARCHAR(80) NOT NULL,
    "objectId" UUID,
    "purpose" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "app"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "app"."AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_expiresAt_idx" ON "app"."AuthSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "Authenticator_userId_kind_idx" ON "app"."Authenticator"("userId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_tokenHash_key" ON "app"."VerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "VerificationToken_userId_purpose_expiresAt_idx" ON "app"."VerificationToken"("userId", "purpose", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "app"."Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "app"."Permission"("code");

-- CreateIndex
CREATE INDEX "RoleAssignment_userId_roleId_scopeType_scopeId_idx" ON "app"."RoleAssignment"("userId", "roleId", "scopeType", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingPurpose_code_key" ON "app"."ProcessingPurpose"("code");

-- CreateIndex
CREATE INDEX "PrivacyPreference_userId_purposeId_effectiveAt_idx" ON "app"."PrivacyPreference"("userId", "purposeId", "effectiveAt");

-- CreateIndex
CREATE INDEX "SubjectRequest_userId_status_idx" ON "app"."SubjectRequest"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_purposeId_dataClass_version_key" ON "app"."RetentionPolicy"("purposeId", "dataClass", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Collection_slug_key" ON "app"."Collection"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_slug_key" ON "app"."Publication"("slug");

-- CreateIndex
CREATE INDEX "Publication_status_kind_idx" ON "app"."Publication"("status", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Volume_publicationId_ordinal_key" ON "app"."Volume"("publicationId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "Volume_id_publicationId_key" ON "app"."Volume"("id", "publicationId");

-- CreateIndex
CREATE INDEX "Edition_publicationId_volumeId_idx" ON "app"."Edition"("publicationId", "volumeId");

-- CreateIndex
CREATE UNIQUE INDEX "Revision_editionId_number_key" ON "app"."Revision"("editionId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Revision_id_editionId_key" ON "app"."Revision"("id", "editionId");

-- CreateIndex
CREATE UNIQUE INDEX "Chapter_revisionId_ordinal_key" ON "app"."Chapter"("revisionId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "Chapter_revisionId_slug_key" ON "app"."Chapter"("revisionId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_chapterId_ordinal_key" ON "app"."Lesson"("chapterId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_storageKey_key" ON "app"."Asset"("storageKey");

-- CreateIndex
CREATE INDEX "Asset_status_createdAt_idx" ON "app"."Asset"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Asset_sha256_idx" ON "app"."Asset"("sha256");

-- CreateIndex
CREATE INDEX "Resource_accessClass_publishedAt_idx" ON "app"."Resource"("accessClass", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceAttachment_resourceId_ordinal_key" ON "app"."ResourceAttachment"("resourceId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialReview_revisionId_reviewerId_manifestHash_key" ON "app"."EditorialReview"("revisionId", "reviewerId", "manifestHash");

-- CreateIndex
CREATE INDEX "PolicyChange_policyId_changedAt_idx" ON "app"."PolicyChange"("policyId", "changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "app"."Plan"("code");

-- CreateIndex
CREATE INDEX "PlanVersion_validFrom_validUntil_idx" ON "app"."PlanVersion"("validFrom", "validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "PlanVersion_planId_version_key" ON "app"."PlanVersion"("planId", "version");

-- CreateIndex
CREATE INDEX "Subscription_userId_status_currentPeriodEnd_idx" ON "app"."Subscription"("userId", "status", "currentPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "TrialUsage_userId_campaignKey_key" ON "app"."TrialUsage"("userId", "campaignKey");

-- CreateIndex
CREATE UNIQUE INDEX "Order_merchantRef_key" ON "app"."Order"("merchantRef");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "app"."Order"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Order_userId_createdAt_idx" ON "app"."Order"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_idempotencyKey_key" ON "app"."PaymentAttempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentAttempt_orderId_status_idx" ON "app"."PaymentAttempt"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_provider_providerRef_key" ON "app"."PaymentAttempt"("provider", "providerRef");

-- CreateIndex
CREATE INDEX "GatewayEvent_processedAt_idx" ON "app"."GatewayEvent"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GatewayEvent_provider_providerEventId_key" ON "app"."GatewayEvent"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_orderId_key" ON "app"."Invoice"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "app"."Invoice"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_providerRefundId_key" ON "app"."Refund"("providerRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_idempotencyKey_key" ON "app"."Refund"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationItem_runId_providerRef_key" ON "app"."ReconciliationItem"("runId", "providerRef");

-- CreateIndex
CREATE INDEX "Entitlement_userId_scope_status_startsAt_endsAt_idx" ON "app"."Entitlement"("userId", "scope", "status", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "Entitlement_membershipId_idx" ON "app"."Entitlement"("membershipId");

-- CreateIndex
CREATE INDEX "EntitlementEvent_entitlementId_occurredAt_idx" ON "app"."EntitlementEvent"("entitlementId", "occurredAt");

-- CreateIndex
CREATE INDEX "GrantApproval_entitlementId_status_idx" ON "app"."GrantApproval"("entitlementId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InstitutionDomain_domain_key" ON "app"."InstitutionDomain"("domain");

-- CreateIndex
CREATE INDEX "InstitutionDomain_institutionId_verifiedAt_idx" ON "app"."InstitutionDomain"("institutionId", "verifiedAt");

-- CreateIndex
CREATE INDEX "Membership_status_expiresAt_idx" ON "app"."Membership"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_institutionId_userId_key" ON "app"."Membership"("institutionId", "userId");

-- CreateIndex
CREATE INDEX "EligibilityPolicy_institutionId_active_idx" ON "app"."EligibilityPolicy"("institutionId", "active");

-- CreateIndex
CREATE INDEX "EligibilityReview_membershipId_reviewedAt_idx" ON "app"."EligibilityReview"("membershipId", "reviewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Cohort_institutionId_name_key" ON "app"."Cohort"("institutionId", "name");

-- CreateIndex
CREATE INDEX "ReadingProgress_userId_updatedAt_idx" ON "app"."ReadingProgress"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReadingProgress_userId_lessonId_key" ON "app"."ReadingProgress"("userId", "lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "Bookmark_userId_revisionId_anchor_key" ON "app"."Bookmark"("userId", "revisionId", "anchor");

-- CreateIndex
CREATE INDEX "Annotation_userId_revisionId_idx" ON "app"."Annotation"("userId", "revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "Quiz_lessonId_version_key" ON "app"."Quiz"("lessonId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "QuizQuestion_quizId_ordinal_key" ON "app"."QuizQuestion"("quizId", "ordinal");

-- CreateIndex
CREATE INDEX "QuizAttempt_userId_quizId_startedAt_idx" ON "app"."QuizAttempt"("userId", "quizId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Project_lessonId_version_key" ON "app"."Project"("lessonId", "version");

-- CreateIndex
CREATE INDEX "ProjectSubmission_userId_projectId_idx" ON "app"."ProjectSubmission"("userId", "projectId");

-- CreateIndex
CREATE INDEX "OfflineLicence_userId_deviceHash_expiresAt_idx" ON "app"."OfflineLicence"("userId", "deviceHash", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SyncOperation_userId_clientOperationId_key" ON "app"."SyncOperation"("userId", "clientOperationId");

-- CreateIndex
CREATE INDEX "Notification_status_createdAt_idx" ON "app"."Notification"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_kind_objectId_status_idx" ON "app"."ApprovalRequest"("kind", "objectId", "status");

-- CreateIndex
CREATE INDEX "AuditEvent_objectType_objectId_occurredAt_idx" ON "app"."AuditEvent"("objectType", "objectId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_occurredAt_idx" ON "app"."AuditEvent"("actorId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_idempotencyKey_key" ON "app"."OutboxEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_publishedAt_occurredAt_idx" ON "app"."OutboxEvent"("publishedAt", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "PseudonymLink_pseudonym_key" ON "research_private"."PseudonymLink"("pseudonym");

-- CreateIndex
CREATE INDEX "PseudonymLink_userId_idx" ON "research_private"."PseudonymLink"("userId");

-- CreateIndex
CREATE INDEX "ResearchSession_pseudonym_startedAt_idx" ON "research"."ResearchSession"("pseudonym", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchEvent_eventId_key" ON "research"."ResearchEvent"("eventId");

-- CreateIndex
CREATE INDEX "ResearchEvent_eventType_eventAt_idx" ON "research"."ResearchEvent"("eventType", "eventAt");

-- CreateIndex
CREATE INDEX "ResearchEvent_retentionUntil_idx" ON "research"."ResearchEvent"("retentionUntil");

-- CreateIndex
CREATE INDEX "ResearchEvent_pseudonym_eventAt_idx" ON "research"."ResearchEvent"("pseudonym", "eventAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchMetric_code_version_key" ON "research"."ResearchMetric"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchAggregate_metricId_periodStart_periodEnd_dimensions_key" ON "research"."ResearchAggregate"("metricId", "periodStart", "periodEnd", "dimensionsHash");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchReport_snapshotKey_key" ON "research"."ResearchReport"("snapshotKey");

-- CreateIndex
CREATE INDEX "DisclosureReview_reportId_reviewedAt_idx" ON "research"."DisclosureReview"("reportId", "reviewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublicInsight_snapshotKey_key" ON "research"."PublicInsight"("snapshotKey");

-- CreateIndex
CREATE INDEX "PublicInsight_publishedAt_withdrawnAt_idx" ON "research"."PublicInsight"("publishedAt", "withdrawnAt");

-- CreateIndex
CREATE INDEX "ResearchExport_expiresAt_status_idx" ON "research"."ResearchExport"("expiresAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchDisclosurePolicy_version_key" ON "research"."ResearchDisclosurePolicy"("version");

-- CreateIndex
CREATE INDEX "ResearchAudit_objectType_objectId_occurredAt_idx" ON "research"."ResearchAudit"("objectType", "objectId", "occurredAt");

-- AddForeignKey
ALTER TABLE "app"."UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Authenticator" ADD CONSTRAINT "Authenticator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."VerificationToken" ADD CONSTRAINT "VerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "app"."Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "app"."Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."RoleAssignment" ADD CONSTRAINT "RoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."RoleAssignment" ADD CONSTRAINT "RoleAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "app"."Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."PrivacyPreference" ADD CONSTRAINT "PrivacyPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."PrivacyPreference" ADD CONSTRAINT "PrivacyPreference_purposeId_fkey" FOREIGN KEY ("purposeId") REFERENCES "app"."ProcessingPurpose"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."SubjectRequest" ADD CONSTRAINT "SubjectRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."RetentionPolicy" ADD CONSTRAINT "RetentionPolicy_purposeId_fkey" FOREIGN KEY ("purposeId") REFERENCES "app"."ProcessingPurpose"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."PublicationCollection" ADD CONSTRAINT "PublicationCollection_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "app"."Publication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."PublicationCollection" ADD CONSTRAINT "PublicationCollection_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "app"."Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Publication" ADD CONSTRAINT "Publication_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Volume" ADD CONSTRAINT "Volume_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "app"."Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Edition" ADD CONSTRAINT "Edition_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "app"."Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Edition" ADD CONSTRAINT "Edition_volumeId_publicationId_fkey" FOREIGN KEY ("volumeId", "publicationId") REFERENCES "app"."Volume"("id", "publicationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Edition" ADD CONSTRAINT "Edition_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "app"."Revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Revision" ADD CONSTRAINT "Revision_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "app"."Edition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Chapter" ADD CONSTRAINT "Chapter_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "app"."Revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Lesson" ADD CONSTRAINT "Lesson_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "app"."Chapter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Lesson" ADD CONSTRAINT "Lesson_bodyAssetId_fkey" FOREIGN KEY ("bodyAssetId") REFERENCES "app"."Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Asset" ADD CONSTRAINT "Asset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Resource" ADD CONSTRAINT "Resource_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "app"."Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Resource" ADD CONSTRAINT "Resource_volumeId_fkey" FOREIGN KEY ("volumeId") REFERENCES "app"."Volume"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Resource" ADD CONSTRAINT "Resource_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "app"."Edition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Resource" ADD CONSTRAINT "Resource_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "app"."Revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Resource" ADD CONSTRAINT "Resource_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "app"."Chapter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Resource" ADD CONSTRAINT "Resource_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "app"."Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ResourceAttachment" ADD CONSTRAINT "ResourceAttachment_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "app"."Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ResourceAttachment" ADD CONSTRAINT "ResourceAttachment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "app"."Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."EditorialReview" ADD CONSTRAINT "EditorialReview_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "app"."Revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."EditorialReview" ADD CONSTRAINT "EditorialReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ContentPolicy" ADD CONSTRAINT "ContentPolicy_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "app"."Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ContentPolicy" ADD CONSTRAINT "ContentPolicy_volumeId_fkey" FOREIGN KEY ("volumeId") REFERENCES "app"."Volume"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ContentPolicy" ADD CONSTRAINT "ContentPolicy_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "app"."Edition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ContentPolicy" ADD CONSTRAINT "ContentPolicy_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "app"."Revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ContentPolicy" ADD CONSTRAINT "ContentPolicy_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "app"."Chapter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ContentPolicy" ADD CONSTRAINT "ContentPolicy_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "app"."Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ContentPolicy" ADD CONSTRAINT "ContentPolicy_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "app"."Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."PolicyChange" ADD CONSTRAINT "PolicyChange_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "app"."ContentPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."PolicyChange" ADD CONSTRAINT "PolicyChange_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."PlanVersion" ADD CONSTRAINT "PlanVersion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "app"."Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Subscription" ADD CONSTRAINT "Subscription_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "app"."PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."TrialUsage" ADD CONSTRAINT "TrialUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Order" ADD CONSTRAINT "Order_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "app"."PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "app"."Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."GatewayEvent" ADD CONSTRAINT "GatewayEvent_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "app"."PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Invoice" ADD CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "app"."Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Refund" ADD CONSTRAINT "Refund_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "app"."PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ReconciliationItem" ADD CONSTRAINT "ReconciliationItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "app"."ReconciliationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ReconciliationItem" ADD CONSTRAINT "ReconciliationItem_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "app"."PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Entitlement" ADD CONSTRAINT "Entitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Entitlement" ADD CONSTRAINT "Entitlement_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "app"."Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Entitlement" ADD CONSTRAINT "Entitlement_volumeId_fkey" FOREIGN KEY ("volumeId") REFERENCES "app"."Volume"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Entitlement" ADD CONSTRAINT "Entitlement_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "app"."Edition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Entitlement" ADD CONSTRAINT "Entitlement_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "app"."Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Entitlement" ADD CONSTRAINT "Entitlement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "app"."Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Entitlement" ADD CONSTRAINT "Entitlement_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "app"."Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Entitlement" ADD CONSTRAINT "Entitlement_trialUsageId_fkey" FOREIGN KEY ("trialUsageId") REFERENCES "app"."TrialUsage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Entitlement" ADD CONSTRAINT "Entitlement_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "app"."Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."EntitlementEvent" ADD CONSTRAINT "EntitlementEvent_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "app"."Entitlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."GrantApproval" ADD CONSTRAINT "GrantApproval_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "app"."Entitlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."GrantApproval" ADD CONSTRAINT "GrantApproval_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."GrantApproval" ADD CONSTRAINT "GrantApproval_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."InstitutionDomain" ADD CONSTRAINT "InstitutionDomain_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "app"."Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."InstitutionDomain" ADD CONSTRAINT "InstitutionDomain_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Membership" ADD CONSTRAINT "Membership_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "app"."Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."EligibilityPolicy" ADD CONSTRAINT "EligibilityPolicy_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "app"."Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."EligibilityReview" ADD CONSTRAINT "EligibilityReview_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "app"."Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."EligibilityReview" ADD CONSTRAINT "EligibilityReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Cohort" ADD CONSTRAINT "Cohort_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "app"."Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."CohortMember" ADD CONSTRAINT "CohortMember_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "app"."Cohort"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."CohortMember" ADD CONSTRAINT "CohortMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ReadingProgress" ADD CONSTRAINT "ReadingProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ReadingProgress" ADD CONSTRAINT "ReadingProgress_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "app"."Edition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ReadingProgress" ADD CONSTRAINT "ReadingProgress_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "app"."Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Bookmark" ADD CONSTRAINT "Bookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Bookmark" ADD CONSTRAINT "Bookmark_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "app"."Edition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Bookmark" ADD CONSTRAINT "Bookmark_revisionId_editionId_fkey" FOREIGN KEY ("revisionId", "editionId") REFERENCES "app"."Revision"("id", "editionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Annotation" ADD CONSTRAINT "Annotation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Annotation" ADD CONSTRAINT "Annotation_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "app"."Edition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Annotation" ADD CONSTRAINT "Annotation_revisionId_editionId_fkey" FOREIGN KEY ("revisionId", "editionId") REFERENCES "app"."Revision"("id", "editionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Quiz" ADD CONSTRAINT "Quiz_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "app"."Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Quiz" ADD CONSTRAINT "Quiz_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "app"."Revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."QuizQuestion" ADD CONSTRAINT "QuizQuestion_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "app"."Quiz"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."QuizAttempt" ADD CONSTRAINT "QuizAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."QuizAttempt" ADD CONSTRAINT "QuizAttempt_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "app"."Quiz"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."QuizAnswer" ADD CONSTRAINT "QuizAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "app"."QuizAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."QuizAnswer" ADD CONSTRAINT "QuizAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "app"."QuizQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Project" ADD CONSTRAINT "Project_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "app"."Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ProjectSubmission" ADD CONSTRAINT "ProjectSubmission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "app"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ProjectSubmission" ADD CONSTRAINT "ProjectSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ProjectSubmission" ADD CONSTRAINT "ProjectSubmission_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "app"."Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."OfflineLicence" ADD CONSTRAINT "OfflineLicence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."OfflineLicence" ADD CONSTRAINT "OfflineLicence_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "app"."Edition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."OfflineLicence" ADD CONSTRAINT "OfflineLicence_revisionId_editionId_fkey" FOREIGN KEY ("revisionId", "editionId") REFERENCES "app"."Revision"("id", "editionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."SyncOperation" ADD CONSTRAINT "SyncOperation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "app"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_private"."PseudonymLink" ADD CONSTRAINT "PseudonymLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research"."ResearchEvent" ADD CONSTRAINT "ResearchEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "research"."ResearchSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research"."ResearchEvent" ADD CONSTRAINT "ResearchEvent_purposeId_fkey" FOREIGN KEY ("purposeId") REFERENCES "app"."ProcessingPurpose"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research"."ResearchEvent" ADD CONSTRAINT "ResearchEvent_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "app"."Publication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research"."ResearchEvent" ADD CONSTRAINT "ResearchEvent_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "app"."Revision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research"."ResearchAggregate" ADD CONSTRAINT "ResearchAggregate_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "research"."ResearchMetric"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research"."ResearchReport" ADD CONSTRAINT "ResearchReport_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "research"."ResearchStudy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research"."DisclosureReview" ADD CONSTRAINT "DisclosureReview_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "research"."ResearchReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research"."DisclosureReview" ADD CONSTRAINT "DisclosureReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research"."PublicInsight" ADD CONSTRAINT "PublicInsight_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "research"."ResearchReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research"."PublicInsight" ADD CONSTRAINT "PublicInsight_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "research"."DisclosureReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research"."PublicInsight" ADD CONSTRAINT "PublicInsight_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "research"."ResearchDisclosurePolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research"."PublicInsight" ADD CONSTRAINT "PublicInsight_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research"."PublicInsight" ADD CONSTRAINT "PublicInsight_exceptionApprovalId_fkey" FOREIGN KEY ("exceptionApprovalId") REFERENCES "app"."ApprovalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research"."ResearchExport" ADD CONSTRAINT "ResearchExport_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research"."ResearchAudit" ADD CONSTRAINT "ResearchAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "app"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
