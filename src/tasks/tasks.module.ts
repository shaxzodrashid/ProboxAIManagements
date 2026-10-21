import { Module } from "@nestjs/common";
import { SharedTaskContentController } from "./shared-task-content.controller";
import { SharedTaskContentService } from "./shared-task-content.service";
import { SharedTasksController } from "./shared-tasks.controller";
import { SharedTasksService } from "./shared-tasks.service";
import { HumanTasksController } from "./human-tasks.controller";
import { HumanTasksService } from "./human-tasks.service";
import { HumanTaskActionsService } from "./human-task-actions.service";
import { HumanTaskActionsController } from "./human-task-actions.controller";
import { AuthModule } from "../auth/auth.module";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";
import { TaskBoardsController } from "./task-boards.controller";
import { TaskBoardsService } from "./task-boards.service";
import { TaskDeadlinesController } from "./task-deadlines.controller";
import { TaskDeadlinesService } from "./task-deadlines.service";
@Module({
  imports: [AuthModule],
  controllers: [
    SharedTaskContentController,
    SharedTasksController,
    HumanTaskActionsController,
    TasksController,
    TaskBoardsController,
    TaskDeadlinesController,
    HumanTasksController,
  ],
  providers: [
    SharedTaskContentService,
    SharedTasksService,
    HumanTaskActionsService,
    TasksService,
    TaskBoardsService,
    TaskDeadlinesService,
    HumanTasksService,
  ],
})
export class TasksModule {}
