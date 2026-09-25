import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCollectors1761000000000 implements MigrationInterface {
  name = 'CreateCollectors1761000000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "collectors" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "identification" varchar NOT NULL, "first_name" varchar NOT NULL, "first_last_name" varchar NOT NULL, "second_last_name" varchar, "phone" varchar NOT NULL, "alternative_phone" varchar, "email" varchar, "birth_date" date NOT NULL, "address" text NOT NULL, "photo_file_key" varchar, "user_id" uuid, "is_active" boolean NOT NULL DEFAULT true, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "PK_collectors" PRIMARY KEY ("id"), CONSTRAINT "FK_collectors_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION, CONSTRAINT "CK_collectors_identification_nonblank" CHECK (btrim("identification") <> ''), CONSTRAINT "CK_collectors_first_name_nonblank" CHECK (btrim("first_name") <> ''), CONSTRAINT "CK_collectors_first_last_name_nonblank" CHECK (btrim("first_last_name") <> ''), CONSTRAINT "CK_collectors_phone_nonblank" CHECK (btrim("phone") <> ''), CONSTRAINT "CK_collectors_address_nonblank" CHECK (btrim("address") <> ''), CONSTRAINT "CK_collectors_birth_date_not_future" CHECK ("birth_date" <= CURRENT_DATE))`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collectors_identification_lower" ON "collectors" (lower("identification"))`);
    await q.query(`CREATE UNIQUE INDEX "UQ_collectors_user_id" ON "collectors" ("user_id") WHERE "user_id" IS NOT NULL`);
  }
  async down(q: QueryRunner): Promise<void> { await q.query(`DROP INDEX "UQ_collectors_user_id"`); await q.query(`DROP INDEX "UQ_collectors_identification_lower"`); await q.query(`DROP TABLE "collectors"`); }
}
