import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAssignmentActors1760900000000 implements MigrationInterface {
  name = 'AddAssignmentActors1760900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "customer_route_assignments" ADD "assigned_by_user_id" uuid NOT NULL');
    await queryRunner.query('ALTER TABLE "collector_route_assignments" ADD "assigned_by_user_id" uuid NOT NULL');
    await queryRunner.query('ALTER TABLE "customer_route_assignments" ADD CONSTRAINT "FK_cra_assigned_by_user" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT');
    await queryRunner.query('ALTER TABLE "collector_route_assignments" ADD CONSTRAINT "FK_cola_assigned_by_user" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "collector_route_assignments" DROP CONSTRAINT "FK_cola_assigned_by_user"');
    await queryRunner.query('ALTER TABLE "customer_route_assignments" DROP CONSTRAINT "FK_cra_assigned_by_user"');
    await queryRunner.query('ALTER TABLE "collector_route_assignments" DROP COLUMN "assigned_by_user_id"');
    await queryRunner.query('ALTER TABLE "customer_route_assignments" DROP COLUMN "assigned_by_user_id"');
  }
}
