import { MigrationInterface, QueryRunner } from 'typeorm';

type AssignmentInconsistency = { kind: string; subjectId: string; activeCount: number; assignmentIds: string[] };

export class EnforceActiveRouteAssignmentOwnership1762000000000 implements MigrationInterface {
  name = 'EnforceActiveRouteAssignmentOwnership1762000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const inconsistencies: AssignmentInconsistency[] = await queryRunner.query(`
      SELECT 'CUSTOMER_MULTIPLE_ACTIVE' AS kind, customer_id AS "subjectId", COUNT(*)::int AS "activeCount", ARRAY_AGG(id ORDER BY assigned_at, id) AS "assignmentIds"
      FROM customer_route_assignments WHERE ended_at IS NULL GROUP BY customer_id HAVING COUNT(*) > 1
      UNION ALL
      SELECT 'ROUTE_MULTIPLE_ACTIVE_COLLECTORS', route_id, COUNT(*)::int, ARRAY_AGG(id ORDER BY assigned_at, id)
      FROM collector_route_assignments WHERE ended_at IS NULL GROUP BY route_id HAVING COUNT(*) > 1
      UNION ALL
      SELECT 'DUPLICATE_ACTIVE_CUSTOMER_ROUTE', customer_id, COUNT(*)::int, ARRAY_AGG(id ORDER BY assigned_at, id)
      FROM customer_route_assignments WHERE ended_at IS NULL GROUP BY customer_id, route_id HAVING COUNT(*) > 1
      UNION ALL
      SELECT 'DUPLICATE_ACTIVE_COLLECTOR_ROUTE', route_id, COUNT(*)::int, ARRAY_AGG(id ORDER BY assigned_at, id)
      FROM collector_route_assignments WHERE ended_at IS NULL GROUP BY route_id, collector_user_id HAVING COUNT(*) > 1
      ORDER BY kind, "subjectId"`);
    if (inconsistencies.length) throw new Error(`Active route assignment inconsistencies require manual cleanup: ${JSON.stringify(inconsistencies)}`);
    await queryRunner.query('CREATE UNIQUE INDEX "UQ_customer_route_assignments_active_customer" ON "customer_route_assignments" ("customer_id") WHERE "ended_at" IS NULL');
    await queryRunner.query('CREATE UNIQUE INDEX "UQ_collector_route_assignments_active_route" ON "collector_route_assignments" ("route_id") WHERE "ended_at" IS NULL');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "UQ_collector_route_assignments_active_route"');
    await queryRunner.query('DROP INDEX "UQ_customer_route_assignments_active_customer"');
  }
}
