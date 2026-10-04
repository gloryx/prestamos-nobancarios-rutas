import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAssignmentActors1760900000000 implements MigrationInterface {
  name = 'AddAssignmentActors1760900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const [existing] = await queryRunner.query(`SELECT
      (SELECT COUNT(*)::int FROM information_schema.columns WHERE table_schema = current_schema()
        AND table_name IN ('customer_route_assignments', 'collector_route_assignments')
        AND column_name = 'assigned_by_user_id') AS columns,
      (SELECT COUNT(*)::int FROM pg_constraint WHERE connamespace = current_schema()::regnamespace
        AND conname IN ('FK_cra_assigned_by', 'FK_cola_assigned_by')) AS constraints`);
    if (existing.columns === 2 && existing.constraints === 2) return;
    if (existing.columns !== 0 || existing.constraints !== 0) throw new Error('Assignment actor schema is incomplete.');
    await queryRunner.query('ALTER TABLE "customer_route_assignments" ADD "assigned_by_user_id" uuid NOT NULL');
    await queryRunner.query('ALTER TABLE "collector_route_assignments" ADD "assigned_by_user_id" uuid NOT NULL');
    await queryRunner.query('ALTER TABLE "customer_route_assignments" ADD CONSTRAINT "FK_cra_assigned_by_user" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT');
    await queryRunner.query('ALTER TABLE "collector_route_assignments" ADD CONSTRAINT "FK_cola_assigned_by_user" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const [existing] = await queryRunner.query(`SELECT COUNT(*)::int AS count FROM pg_constraint
      WHERE connamespace = current_schema()::regnamespace AND conname IN ('FK_cra_assigned_by_user', 'FK_cola_assigned_by_user')`);
    if (existing.count === 0) return;
    if (existing.count !== 2) throw new Error('Assignment actor rollback schema is incomplete.');
    await queryRunner.query('ALTER TABLE "collector_route_assignments" DROP CONSTRAINT "FK_cola_assigned_by_user"');
    await queryRunner.query('ALTER TABLE "customer_route_assignments" DROP CONSTRAINT "FK_cra_assigned_by_user"');
    await queryRunner.query('ALTER TABLE "collector_route_assignments" DROP COLUMN "assigned_by_user_id"');
    await queryRunner.query('ALTER TABLE "customer_route_assignments" DROP COLUMN "assigned_by_user_id"');
  }
}
