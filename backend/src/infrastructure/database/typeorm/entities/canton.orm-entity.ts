import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from 'typeorm';
import { DistrictOrmEntity } from './district.orm-entity';
import { ProvinceOrmEntity } from './province.orm-entity';

@Entity({ name: 'cantons' })
@Index('idx_cantons_province_code', ['provinceCode'])
export class CantonOrmEntity {
  @PrimaryColumn({ type: 'smallint' })
  code!: number;

  @Column({ type: 'varchar', nullable: false })
  name!: string;

  @Column({ name: 'province_code', type: 'smallint' })
  provinceCode!: number;

  @ManyToOne(() => ProvinceOrmEntity, (province) => province.cantons, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'province_code', referencedColumnName: 'code' })
  province!: ProvinceOrmEntity;

  @OneToMany(() => DistrictOrmEntity, (district) => district.canton)
  districts!: DistrictOrmEntity[];
}
