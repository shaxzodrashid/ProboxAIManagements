import { Module } from "@nestjs/common";
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
    HumanTaskActionsController,
    TasksController,
    TaskBoardsController,
    TaskDeadlinesController,
    HumanTasksController,
  ],
  providers: [
    HumanTaskActionsService,
    TasksService,
    TaskBoardsService,
    TaskDeadlinesService,
    HumanTasksService,
  ],
})
export class TasksModule {}
