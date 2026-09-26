import { validate } from 'class-validator';
import { CustomerListQueryDto } from '../src/presentation/customer/customer.dto';
import { CustomerTypeOrmRepository } from '../src/infrastructure/database/typeorm/repositories/customer.typeorm-repository';

describe('customer list sorting', () => {
  it('rejects sort values outside the public allowlist', async () => {
    const query = Object.assign(new CustomerListQueryDto(), { sortBy: 'createdAt', sortOrder: 'ASC' });
    const errors = await validate(query);
    expect(errors.flatMap((error) => Object.values(error.constraints ?? {}))).toEqual(expect.arrayContaining(['sortBy must be one of the following values: identification, name, phone, address, status', 'sortOrder must be one of the following values: asc, desc']));
  });

  it('applies the requested order before pagination', async () => {
    const events: string[] = [];
    const queryBuilder = {
      leftJoin: () => queryBuilder,
      select: () => queryBuilder,
      andWhere: () => queryBuilder,
      orderBy: (column: string, direction: string) => { events.push(`order:${column}:${direction}`); return queryBuilder; },
      addOrderBy: (column: string, direction: string) => { events.push(`order:${column}:${direction}`); return queryBuilder; },
      skip: () => { events.push('skip'); return queryBuilder; },
      take: () => { events.push('take'); return queryBuilder; },
      getRawMany: async () => [],
      getCount: async () => 0,
    };
    const repository = new CustomerTypeOrmRepository({ createQueryBuilder: () => queryBuilder } as never, {} as never);

    await repository.list({ status: 'ALL', sortBy: 'name', sortOrder: 'asc', page: 2, pageSize: 10 });

    expect(events).toEqual([
      'order:LOWER(CONCAT_WS(\' \', customer.first_name, customer.middle_name, customer.first_last_name, customer.second_last_name)):ASC',
      'order:customer.id:ASC',
      'skip',
      'take',
    ]);
  });

  it('puts active customers first for ASC status and inactive customers first for DESC status', async () => {
    const directions: string[] = [];
    const queryBuilder = {
      leftJoin: () => queryBuilder,
      select: () => queryBuilder,
      andWhere: () => queryBuilder,
      orderBy: (_column: string, direction: string) => { directions.push(direction); return queryBuilder; },
      addOrderBy: () => queryBuilder,
      skip: () => queryBuilder,
      take: () => queryBuilder,
      getRawMany: async () => [],
      getCount: async () => 0,
    };
    const repository = new CustomerTypeOrmRepository({ createQueryBuilder: () => queryBuilder } as never, {} as never);

    await repository.list({ status: 'ALL', sortBy: 'status', sortOrder: 'asc', page: 1, pageSize: 10 });
    await repository.list({ status: 'ALL', sortBy: 'status', sortOrder: 'desc', page: 1, pageSize: 10 });

    expect(directions).toEqual(['DESC', 'ASC']);
  });
});
