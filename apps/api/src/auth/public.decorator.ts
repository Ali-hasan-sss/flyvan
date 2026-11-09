import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "flyvan:public";

export const Public = () => SetMetadata(IS_PUBLIC, true);
