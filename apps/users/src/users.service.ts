import { lastValueFrom } from 'rxjs'
import { ClientProxy } from '@nestjs/microservices'
import * as bcrypt from 'bcrypt'
import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common'

import { UserData } from '@users/dto/user-data.dto'
import { sanitizeUser } from '@users/helpers/sanitize-user'
import { UsersRepository } from '@users/users.repository'
import { CreateUserRequest } from '@users/dto/create-user.request'
import { PaginationOptions } from '@app/common'
import { UpdateUserRequest } from '@users/dto/update-user.request'
import { User, UserRole, UserStatus } from '@users/schemas/user.schema'
import { AUDITORS_SERVICE, PROJECTS_SERVICE } from '@users/constants/services'

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name)

  constructor(
    private readonly usersRepository: UsersRepository,
    @Inject(PROJECTS_SERVICE) private projectsClient: ClientProxy,
    @Inject(AUDITORS_SERVICE) private auditorsClient: ClientProxy,
  ) {}

  async createUser(request: CreateUserRequest): Promise<User> {
    let session, user

    session = await this.usersRepository.startTransaction()

    try {
      user = await this.usersRepository.create({
        ...request,
        role: UserRole.USER,
        createdAt: new Date(),
        updatedAt: new Date(),
        status: UserStatus.NEW,
        password: await bcrypt.hash(request.password, 10),
      })

      await lastValueFrom(
        this.projectsClient.emit('user_created', {
          request,
        }),
      )
      await lastValueFrom(
        this.auditorsClient.emit('user_created', {
          request,
        }),
      )
      await session.commitTransaction()
      return user
    } catch (err) {
      await session.abortTransaction()
      throw err
    }
  }

  async updateUser(user: User, request: UpdateUserRequest): Promise<User> {
    return this.usersRepository.findOneAndUpdate(user, {
      ...request,
      updatedAt: new Date(),
      password: request.password
        ? await bcrypt.hash(request.password, 10)
        : user.password,
    })
  }

  async deleteUser(user: User): Promise<true> {
    return this.usersRepository.delete(user).then(() => true)
  }

  async getUsers(options: PaginationOptions): Promise<UserData[]> {
    return this.usersRepository
      .find({
        skip: (options.page - 1) * options.limit,
        take: options.limit,
      })
      .then((users) => users.map(sanitizeUser))
  }

  async getUser(getUserArgs: Partial<User>): Promise<User> {
    return this.usersRepository.findOne(getUserArgs)
  }

  async validateUser(email: string, password: string) {
    const user = await this.usersRepository.findOne({ email })
    const passwordIsValid = await bcrypt.compare(password, user.password)

    if (!passwordIsValid) {
      throw new UnauthorizedException('Credentials are not valid.')
    }
    return user
  }

  log(data: any) {
    this.logger.log(data)
  }
}

