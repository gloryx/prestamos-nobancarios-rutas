import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { CantonOrmEntity } from './canton.orm-entity';

@Entity({ name: 'districts' })
@Index('idx_districts_canton_code', ['cantonCode'])
export class DistrictOrmEntity {
  @PrimaryColumn({ type: 'integer' })
  code!: number;

  @Column({ type: 'varchar', nullable: false })
  name!: string;

  @Column({ name: 'canton_code', type: 'smallint' })
  cantonCode!: number;

  @ManyToOne(() => CantonOrmEntity, (canton) => canton.districts, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'canton_code', referencedColumnName: 'code' })
  canton!: CantonOrmEntity;
}
