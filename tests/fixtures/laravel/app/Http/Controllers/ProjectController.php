<?php

namespace App\Http\Controllers;

use App\Http\Resources\ProjectResource;
use Illuminate\Http\Request;

class ProjectController extends Controller
{
    public function index()
    {
        $page = request()->query('page');

        return ProjectResource::collection(
            Project::query()->paginate(15, ['*'], 'page', $page)
        );
    }

    public function show(Request $request)
    {
        Project::query()->findOrFail(1);

        return ProjectResource::make((object) [
            'id' => 1,
            'name' => 'Launchpad',
            'owner_email' => 'owner@example.com',
        ])->additional([
            'meta' => [
                'trace_id' => 'trace_123',
            ],
        ]);
    }
}
