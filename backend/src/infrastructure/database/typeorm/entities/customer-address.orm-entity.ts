import { Column, CreateDateColumn, Entity, Index, JoinColumn, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { CustomerOrmEntity } from './customer.orm-entity';
import { DistrictOrmEntity } from './district.orm-entity';
@Entity({ name: 'customer_addresses' })
@Index('UQ_customer_addresses_customer_id', ['customerId'], { unique: true })
@Index('idx_customer_addresses_district_code', ['districtCode'])
export class CustomerAddressOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'customer_id', type: 'uuid' }) customerId!: string;
  @Column({ name: 'district_code', type: 'integer' }) districtCode!: number;
  @Column({ name: 'exact_address', type: 'text' }) exactAddress!: string;
  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true }) latitude!: number | null;
  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true }) longitude!: number | null;
  @Column({ name: 'property_photo_file_key', type: 'varchar', nullable: true }) propertyPhotoFileKey!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
  @OneToOne(() => CustomerOrmEntity, (customer) => customer.address, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'customer_id' }) customer!: CustomerOrmEntity;
  @OneToOne(() => DistrictOrmEntity, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'district_code', referencedColumnName: 'code' }) district!: DistrictOrmEntity;
}
