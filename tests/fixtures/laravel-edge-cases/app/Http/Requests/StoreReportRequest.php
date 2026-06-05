<?php

namespace App\Http\Requests;

use App\Enums\ReportStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Enum;

class StoreReportRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'max:120'],
            'status' => ['required', new Enum(ReportStatus::class)],
            'published_at' => ['required_if:status,published', 'date'],
            'reviewer_email' => ['sometimes', 'email'],
            'category' => [Rule::requiredIf($this->input('status') === 'published'), 'string'],
        ];
    }
}
