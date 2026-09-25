import { Column, Entity, OneToMany, PrimaryColumn } from 'typeorm';
import { CantonOrmEntity } from './canton.orm-entity';

@Entity({ name: 'provinces' })
export class ProvinceOrmEntity {
  @PrimaryColumn({ type: 'smallint' })
  code!: number;

  @Column({ type: 'varchar', nullable: false })
  name!: string;

  @OneToMany(() => CantonOrmEntity, (canton) => canton.province)
  cantons!: CantonOrmEntity[];
}
