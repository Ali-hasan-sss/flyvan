import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../auth/access.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import type { PublicUser } from "../auth/public-user";
import { CreateUserDto, DisableUserDto, ListUsersQueryDto, UpdateUserDto } from "./users.dto";
import { UserAdminError, type UserAdminCode } from "./user-policy";
import { UsersService } from "./users.service";

const messages: Record<UserAdminCode, { status: number; message: string }> = {
  SELF_DISABLE: { status: 403, message: "لا يمكنك تعطيل حسابك." },
  SELF_ROLE: { status: 403, message: "لا يمكنك تغيير دورك." },
  LAST_OWNER: { status: 409, message: "يجب أن يبقى مالك منصة نشط واحد على الأقل." },
  PASSWORD: { status: 400, message: "كلمة المرور يجب أن تكون 8 أحرف على الأقل." },
  IDENTIFIER: { status: 400, message: "أدخل بريدًا أو هاتفًا." },
  EMAIL: { status: 400, message: "البريد غير صالح." },
  PHONE: { status: 400, message: "رقم الهاتف مطلوب ويجب أن يكون صالحًا وفريدًا." },
  ROLE: { status: 400, message: "الدور غير معروف." },
  NAME: { status: 400, message: "الاسم يجب أن يكون بين حرفين و80 حرفًا." },
  NOT_FOUND: { status: 404, message: "المستخدم غير موجود." },
  DUPLICATE: { status: 409, message: "رقم الهاتف أو البريد مستخدم من قبل." },
  EMPTY: { status: 400, message: "لا يوجد تغيير ليُحفظ." },
};

@ApiTags("users")
@ApiBearerAuth()
@RequirePermissions("USERS_MANAGE")
@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: "قائمة المستخدمين" })
  list(@Query() query: ListUsersQueryDto) {
    return this.users.list(query.page, query.pageSize);
  }

  @Get(":id")
  @ApiOperation({ summary: "قراءة مستخدم" })
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.call(() => this.users.get(id));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "إنشاء مستخدم" })
  create(@CurrentUser() actor: PublicUser, @Body() body: CreateUserDto) {
    return this.call(() => this.users.create(actor.id, body));
  }

  @Patch(":id")
  @ApiOperation({ summary: "تعديل الاسم أو الدور أو كلمة المرور" })
  update(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: UpdateUserDto) {
    return this.call(() => this.users.update(actor.id, id, body));
  }

  @Post(":id/disable")
  @ApiOperation({ summary: "تعطيل مستخدم وإبطال جلساته" })
  disable(
    @CurrentUser() actor: PublicUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: DisableUserDto,
  ) {
    return this.call(() => this.users.disable(actor.id, id, body.reason));
  }

  @Post(":id/enable")
  @ApiOperation({ summary: "إعادة تفعيل مستخدم" })
  enable(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.call(() => this.users.enable(actor.id, id));
  }

  private async call<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof UserAdminError) {
        const mapped = messages[error.code];
        throw new HttpException(mapped.message, mapped.status);
      }
      throw error;
    }
  }
}
