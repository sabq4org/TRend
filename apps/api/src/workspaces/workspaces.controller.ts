import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  createOrgUnitSchema,
  inviteMemberSchema,
  type CreateOrgUnitInput,
  type InviteMemberInput,
} from '@trend/schemas';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { WorkspacesService } from './workspaces.service';

const limitSchema = z.coerce.number().int().min(1).max(200).default(50);

@Controller('workspaces/:workspaceId')
export class WorkspacesController {
  constructor(private readonly service: WorkspacesService) {}

  @Get('org-units')
  listOrgUnits(
    @CurrentPrincipal() p: Principal,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ) {
    return this.service.listOrgUnits(p, workspaceId);
  }

  @Post('org-units')
  createOrgUnit(
    @CurrentPrincipal() p: Principal,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body(new ZodPipe(createOrgUnitSchema)) body: CreateOrgUnitInput,
  ) {
    return this.service.createOrgUnit(p, workspaceId, body);
  }

  @Get('members')
  listMembers(
    @CurrentPrincipal() p: Principal,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ) {
    return this.service.listMembers(p, workspaceId);
  }

  @Post('members')
  inviteMember(
    @CurrentPrincipal() p: Principal,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body(new ZodPipe(inviteMemberSchema)) body: InviteMemberInput,
  ) {
    return this.service.inviteMember(p, workspaceId, body);
  }

  @Get('audit-events')
  listAuditEvents(
    @CurrentPrincipal() p: Principal,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query('limit', new ZodPipe(limitSchema)) limit: number,
  ) {
    return this.service.listAuditEvents(p, workspaceId, limit);
  }
}
