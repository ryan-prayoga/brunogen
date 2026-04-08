<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\ResourceCollection;

class ProjectThroughCollection extends ResourceCollection
{
    public $collects = ProjectResource::class;

    public function toArray(Request $request): array
    {
        return [
            'through' => collect($this->collection)
                ->through(fn ($project) => [
                    'identifier' => $project['id'],
                    'email' => $project['owner_email'],
                    'kind' => 'through-project',
                ])
                ->values()
                ->all(),
        ];
    }
}
