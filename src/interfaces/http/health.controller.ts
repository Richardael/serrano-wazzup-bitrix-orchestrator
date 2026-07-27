import { Controller, Get, Post } from "@nestjs/common";

@Controller()
export class HealthController {
  @Get("health")
  health() {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  @Post("health")
  healthPost() {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  @Get("ready")
  ready() {
    return { status: "ready", timestamp: new Date().toISOString() };
  }
}
