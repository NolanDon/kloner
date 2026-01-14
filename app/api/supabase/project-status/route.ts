// app/api/supabase/project-status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAndMaybeCsrf } from '../../_lib/route-guard';
import { getAdminDb } from '../../_lib/auth';

export async function GET(request: NextRequest) {
  return requireSessionAndMaybeCsrf(
    request,
    async ({ uid, req: authedReq }) => {
      try {
        // Check if user has any recently created Supabase projects
        const db = getAdminDb();
        const projectsRef = db.collection('users').doc(uid).collection('supabase_projects');
        const recentProjects = await projectsRef
          .where('createdAt', '>', new Date(Date.now() - 10 * 60 * 1000)) // Last 10 minutes
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get();

        if (!recentProjects.empty) {
          const project = recentProjects.docs[0].data();
          return NextResponse.json({
            completed: true,
            project: {
              id: project.projectId,
              name: project.name,
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