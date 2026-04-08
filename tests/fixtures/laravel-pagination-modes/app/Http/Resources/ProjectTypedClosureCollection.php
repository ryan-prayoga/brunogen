<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\ResourceCollection;

class ProjectTypedClosureCollection extends ResourceCollection
{
    public $collects = ProjectResource::class;

    public function toArray(Request $request): array
    {
        return [
            'typed_closures' => collect($this->collection)
                ->map(function (array $project) use ($request) {
                    return [
                        'identifier' => $project['id'],
                        'owner' => $project['owner_email'],
                        'label' => 'typed-closure-project',
                    ];
                })
                ->filter(function (array $project) use ($request) {
                    return $project['owner'];
                })
                ->values()
                ->all(),
        ];
    }
}
