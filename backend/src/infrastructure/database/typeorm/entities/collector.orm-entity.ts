import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { UserOrmEntity } from './user.orm-entity';

@Entity({ name: 'collectors' })
export class CollectorOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar' }) identification!: string;
  @Column({ name: 'first_name', type: 'varchar' }) firstName!: string;
  @Column({ name: 'first_last_name', type: 'varchar' }) firstLastName!: string;
  @Column({ name: 'second_last_name', type: 'varchar', nullable: true }) secondLastName!: string | null;
  @Column({ type: 'varchar' }) phone!: string;
  @Column({ name: 'alternative_phone', type: 'varchar', nullable: true }) alternativePhone!: string | null;
  @Column({ type: 'varchar', nullable: true }) email!: string | null;
  @Column({ name: 'birth_date', type: 'date' }) birthDate!: string;
  @Column({ type: 'text' }) address!: string;
  @Column({ name: 'photo_file_key', type: 'varchar', nullable: true }) photoFileKey!: string | null;
  @Column({ name: 'user_id', type: 'uuid', nullable: true, unique: false }) userId!: string | null;
  @ManyToOne(() => UserOrmEntity, { onDelete: 'NO ACTION' }) @JoinColumn({ name: 'user_id' }) user!: UserOrmEntity | null;
  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive!: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
