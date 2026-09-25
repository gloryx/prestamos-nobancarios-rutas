import { Column, CreateDateColumn, Entity, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { CustomerAddressOrmEntity } from './customer-address.orm-entity';
@Entity({ name: 'customers' })
export class CustomerOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'identification_type', type: 'varchar' }) identificationType!: string;
  @Column({ type: 'varchar' }) identification!: string;
  @Column({ name: 'first_name', type: 'varchar' }) firstName!: string;
  @Column({ name: 'middle_name', type: 'varchar', nullable: true }) middleName!: string | null;
  @Column({ name: 'first_last_name', type: 'varchar' }) firstLastName!: string;
  @Column({ name: 'second_last_name', type: 'varchar', nullable: true }) secondLastName!: string | null;
  @Column({ type: 'varchar' }) gender!: string;
  @Column({ name: 'birth_date', type: 'date' }) birthDate!: string;
  @Column({ name: 'primary_phone', type: 'varchar' }) primaryPhone!: string;
  @Column({ name: 'secondary_phone', type: 'varchar', nullable: true }) secondaryPhone!: string | null;
  @Column({ type: 'varchar', nullable: true }) email!: string | null;
  @Column({ type: 'varchar' }) nationality!: string;
  @Column({ name: 'other_nationality', type: 'varchar', nullable: true }) otherNationality!: string | null;
  @Column({ name: 'identification_front_file_key', type: 'varchar', nullable: true }) identificationFrontFileKey!: string | null;
  @Column({ type: 'text', nullable: true }) observations!: string | null;
  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive!: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
  @OneToOne(() => CustomerAddressOrmEntity, (address) => address.customer) address!: CustomerAddressOrmEntity;
}
