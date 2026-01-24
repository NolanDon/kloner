// app/api/supabase/project-status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAndMaybeCsrf } from '../../_lib/route-guard';
import { getAdminDb } from '../../_lib/auth';

export async function GET(request: NextRequest) {
  return requireSessionAndMaybeCsrf(
    request,
    async ({ uid, req: authedReq }) => {
      try {
        // Check if user has a recently created Supabase integration
        const db = getAdminDb();
        const integrationSnap = await db
          .collection("kloner_users")
          .doc(uid)
          .collection("integrations")
          .doc("supabase")
          .get();

        if (integrationSnap.exists) {
          const project = integrationSnap.data() as any;
          return NextResponse.json({
            completed: true,
            project: {
              id: project.projectId,
              name: project.projectName,
              status: project.status,
            }
          });
        }

        return NextResponse.json({ completed: false });

      } catch (error) {
        console.error('Error checking project status:', error);
        return NextResponse.json({
          error: 'Failed to check project status',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
      }
    },
    { csrf: false, methods: ['GET'] }
  );
}