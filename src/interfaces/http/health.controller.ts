import { Controller, Get, Post } from "@nestjs/common";

@Controller()
export class HealthController {
  @Get("health")
  health() {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  @Post("wazzup-verify")
  wazzupVerify() {
    return { status: "ok" };
  }

  @Get("ready")
  ready() {
    return { status: "ready", timestamp: new Date().toISOString() };
  }
}
