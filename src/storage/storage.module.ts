import { Global, Module } from "@nestjs/common";
import { WorkspacePathPolicy } from "./workspace-path-policy.service";

@Global()
@Module({
  providers: [WorkspacePathPolicy],
  exports: [WorkspacePathPolicy],
})
export class StorageModule {}
